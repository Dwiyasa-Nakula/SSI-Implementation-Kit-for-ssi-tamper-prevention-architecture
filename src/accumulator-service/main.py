# FastAPI app with 14 endpoints covering all flows. 
# Bootstraps RSA params on first start (1024-bit PoC, configurable to 2048).

"""
SSI Cryptographic Accumulator Service — FastAPI Application

Endpoints:
  GET  /health
  GET  /accumulator/state                         — public accumulator root
  POST /accumulator/add                           — issuer adds credential
  POST /accumulator/revoke                        — governance-approved revocation
  GET  /accumulator/witness/{cred_hash}           — membership witness (for holder)
  GET  /accumulator/non-membership-witness/{h}    — non-membership witness
  POST /zkp/create-non-membership-proof           — generate ZKP proof bundle
  POST /zkp/verify-non-membership-proof           — verify ZKP proof bundle
  POST /zkp/create-predicate-proof                — attribute ZKP (age >= 18)
  POST /zkp/verify-predicate-proof                — verify attribute ZKP
  GET  /fraud/alerts                              — fraud alert log (admin)
  GET  /fraud/analysis                            — accumulator health report
  POST /accumulator/export                        — export state (admin)
  POST /accumulator/import                        — import state (admin)
"""

import os
import json
import time
import secrets
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend

from accumulator import RSAAccumulator, AccumulatorParams
from zkp import ZKPProver, ZKPVerifier
from fraud import FraudDetector
from models import (
    AddCredentialRequest,
    RevokeCredentialRequest,
    CreateZKPProofRequest,
    VerifyZKPProofRequest,
    PredicateProofRequest,
    VerifyPredicateRequest,
    ImportStateRequest,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("accumulator-service")

# ---------------------------------------------------------------------------
# Global singletons (initialised in lifespan)
# ---------------------------------------------------------------------------
_accumulator: RSAAccumulator = None
_prover:      ZKPProver      = None
_verifier:    ZKPVerifier    = None
_detector:    FraudDetector  = None
_redis        = None


# ---------------------------------------------------------------------------
# RSA parameter bootstrap
# ---------------------------------------------------------------------------

PARAMS_FILE = os.getenv("PARAMS_FILE", "/data/acc_params.json")


def _load_or_generate_params() -> AccumulatorParams:
    """
    Load existing RSA accumulator parameters from disk or generate new ones.

    Key sizes:
      1024-bit  — PoC (fast; not suitable for production)
      2048-bit  — Production minimum (set env RSA_KEY_BITS=2048)
    """
    if os.path.exists(PARAMS_FILE):
        logger.info(f"Loading accumulator params from {PARAMS_FILE}")
        with open(PARAMS_FILE) as fh:
            data = json.load(fh)
        return AccumulatorParams(int(data["n"]), int(data["g"]))

    key_bits = int(os.getenv("RSA_KEY_BITS", "1024"))
    logger.info(f"Generating {key_bits}-bit RSA accumulator parameters…")

    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=key_bits,
        backend=default_backend(),
    )
    priv = key.private_numbers()
    n = priv.p * priv.q

    # Generator: random quadratic residue mod n  (g = h² mod n)
    h = secrets.randbelow(n - 2) + 2
    g = pow(h, 2, n)

    os.makedirs(os.path.dirname(PARAMS_FILE), exist_ok=True)
    with open(PARAMS_FILE, "w") as fh:
        json.dump({"n": str(n), "g": str(g), "bits": key_bits}, fh)

    logger.info(f"RSA modulus generated ({len(bin(n)) - 2} bits), saved to {PARAMS_FILE}")
    return AccumulatorParams(n, g)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _accumulator, _prover, _verifier, _detector, _redis

    params      = _load_or_generate_params()
    _accumulator = RSAAccumulator(params)
    _prover      = ZKPProver(_accumulator)
    _verifier    = ZKPVerifier(_accumulator)

    # Redis (optional — degrades gracefully)
    try:
        import redis as _redis_lib
        redis_url  = os.getenv("REDIS_URL", "redis://localhost:6379")
        redis_pass = os.getenv("REDIS_PASSWORD")
        if redis_pass:
            from urllib.parse import urlparse, urlunparse
            u = urlparse(redis_url)
            redis_url = urlunparse(
                u._replace(netloc=f":{redis_pass}@{u.hostname}:{u.port or 6379}")
            )
        _redis = _redis_lib.from_url(redis_url, decode_responses=False)
        _redis.ping()
        logger.info("Redis connected")
    except Exception as exc:
        logger.warning(f"Redis unavailable ({exc}); replay/double-pres checks disabled")
        _redis = None

    _detector = FraudDetector(_redis)
    logger.info("Accumulator Service ready")
    yield
    logger.info("Accumulator Service shutting down")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SSI Cryptographic Accumulator Service",
    description=(
        "RSA-based dynamic accumulator for privacy-preserving credential revocation. "
        "Provides ZKP non-membership proofs (no credential ID revealed to verifier) "
        "and fraud detection for the SSI ecosystem."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

_API_KEYS = set(os.getenv("API_KEYS", "dev-key-1").split(","))


def require_api_key(x_api_key: str = Header(None)) -> str:
    if x_api_key not in _API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return x_api_key


# ---------------------------------------------------------------------------
# Routes — Health & State
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Infra"])
def health():
    return {
        "status":       "ok",
        "epoch":        _accumulator.epoch,
        "member_count": len(_accumulator.members),
        "timestamp":    time.time(),
    }


@app.get("/accumulator/state", tags=["Accumulator"])
def get_accumulator_state():
    """
    Public endpoint — returns the current accumulator root value and epoch.
    Verification Gateways poll this to get the latest Accₜ.
    """
    return {
        "accumulator": str(_accumulator.A),
        "epoch":        _accumulator.epoch,
        "member_count": len(_accumulator.members),
        "log_tail":     [
            {"epoch": e.epoch, "operation": e.operation, "timestamp": e.timestamp}
            for e in _accumulator.state_log[-5:]
        ],
    }


# ---------------------------------------------------------------------------
# Routes — Accumulator CRUD
# ---------------------------------------------------------------------------

@app.post("/accumulator/add", tags=["Accumulator"])
def add_credential(
    req: AddCredentialRequest,
    _: str = Depends(require_api_key),
):
    """Issuer adds a credential hash to the active (non-revoked) accumulator."""
    result = _accumulator.add(req.cred_hash)
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@app.post("/accumulator/revoke", tags=["Accumulator"])
def revoke_credential(
    req: RevokeCredentialRequest,
    _: str = Depends(require_api_key),
):
    """
    Governance-approved revocation.
    Removes credential hash from active set and recomputes the accumulator.
    Logs an append-only REVOKE entry.
    """
    fraud = _detector.check_rapid_revocation(req.issuer_id, req.cred_hash)

    result = _accumulator.revoke(req.cred_hash)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    if fraud:
        result["fraud_alert"] = {
            "type":     fraud.event_type,
            "severity": fraud.severity,
            "message":  fraud.description,
        }

    return result


@app.get("/accumulator/witness/{cred_hash}", tags=["Accumulator"])
def get_membership_witness(
    cred_hash: str,
    _: str = Depends(require_api_key),
):
    """
    Returns membership witness W_x for the given credential hash.
    Used by the Holder to update their wallet after epoch changes.
    """
    w = _accumulator.membership_witness(cred_hash)
    if w is None:
        raise HTTPException(status_code=404, detail="Credential not found in accumulator")
    return w


@app.get("/accumulator/non-membership-witness/{cred_hash}", tags=["Accumulator"])
def get_non_membership_witness(cred_hash: str):
    """
    Returns non-membership (Bezout) witness.
    Called by ZKP proof generation to get (a, d) for the credential.
    Returns 409 if the credential IS an active member (use revoke first).
    """
    w = _accumulator.non_membership_witness(cred_hash)
    if w is None:
        raise HTTPException(
            status_code=409,
            detail="Credential IS an active member — non-membership witness unavailable",
        )
    return w


# ---------------------------------------------------------------------------
# Routes — ZKP
# ---------------------------------------------------------------------------

@app.post("/zkp/create-non-membership-proof", tags=["ZKP"])
def create_non_membership_proof(req: CreateZKPProofRequest):
    """
    Generate ZKP non-membership proof for revocation check.

    Input:  cred_hash (holder's credential), nonce (from RP)
    Output: proof bundle — verifier checks this WITHOUT ever seeing cred_hash

    In production: this runs entirely on the holder device.
    For PoC: the service generates it on behalf of the holder.
    """
    commit_data = _prover.commit(req.cred_hash, req.nonce)
    proof = _prover.non_membership_proof(
        req.cred_hash,
        req.nonce,
        commit_data["commitment"],
        commit_data["randomness"],
    )

    if proof is None:
        raise HTTPException(
            status_code=409,
            detail="Credential IS in the revoked set — proof of non-membership impossible",
        )

    return {
        "proof":      proof,
        "commitment": commit_data["commitment"],
        "_poc_note":  "In production randomness stays on the holder device",
    }


@app.post("/zkp/verify-non-membership-proof", tags=["ZKP"])
def verify_non_membership_proof(req: VerifyZKPProofRequest):
    """
    Verify a ZKP non-membership proof bundle.

    Called by the Verification Gateway after receiving a Verifiable Presentation.
    Returns {valid: true/false} plus detailed breakdown for the thesis evaluation.
    """
    # Anti-replay
    if _redis and req.nonce:
        if _detector.check_replay(req.nonce, req.presentation_id or "unknown"):
            raise HTTPException(status_code=409, detail="REPLAY ATTACK: nonce already consumed")

    result = _verifier.verify_non_membership(req.proof)
    return {
        "valid":                result["valid"],
        "verification_details": result,
        "epoch":                _accumulator.epoch,
        "verified_at":          time.time(),
    }


@app.post("/zkp/create-predicate-proof", tags=["ZKP"])
def create_predicate_proof(req: PredicateProofRequest):
    """
    ZKP attribute predicate — prove age >= 18 without revealing actual age.
    """
    proof = _prover.predicate_proof(
        req.attribute_name,
        req.attribute_value,
        req.predicate,
        req.threshold,
        req.nonce,
    )
    if not proof.get("valid"):
        raise HTTPException(status_code=400, detail=proof.get("error", "Predicate does not hold"))
    return proof


@app.post("/zkp/verify-predicate-proof", tags=["ZKP"])
def verify_predicate_proof(req: VerifyPredicateRequest):
    """Verify an attribute predicate ZKP."""
    return _verifier.verify_predicate(req.proof)


# ---------------------------------------------------------------------------
# Routes — Fraud Detection
# ---------------------------------------------------------------------------

@app.get("/fraud/analysis", tags=["Fraud"])
def fraud_analysis():
    """
    Public health analysis of the accumulator state.
    Used for thesis evaluation (section 3.5.1 security evaluation).
    """
    return _detector.analyze_state(_accumulator.export_state())


@app.get("/fraud/alerts", tags=["Fraud"])
def fraud_alerts(_: str = Depends(require_api_key)):
    """Return recent fraud events (admin only)."""
    return {
        "alerts":   _detector.get_alerts(),
        "analysis": _detector.analyze_state(_accumulator.export_state()),
    }


# ---------------------------------------------------------------------------
# Routes — State persistence (admin)
# ---------------------------------------------------------------------------

@app.get("/accumulator/export", tags=["Admin"])
def export_state(_: str = Depends(require_api_key)):
    """Export full accumulator state for backup / migration."""
    return _accumulator.export_state()


@app.post("/accumulator/import", tags=["Admin"])
def import_state(req: ImportStateRequest, _: str = Depends(require_api_key)):
    """Import accumulator state (disaster recovery)."""
    admin_token = os.getenv("ADMIN_TOKEN", "")
    if req.admin_token != admin_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    _accumulator.import_state(req.state)
    return {"success": True, "epoch": _accumulator.epoch}