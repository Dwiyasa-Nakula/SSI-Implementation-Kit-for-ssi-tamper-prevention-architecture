"""
SSI Gateway API — Backend for Frontend (BFF)
=============================================
Event-driven aggregator. Sits between the React frontend and all backend services.

Architecture:
  Frontend → SSI Gateway (8888) → fan-out →
    ACA-Py Holder  :8031
    ACA-Py Issuer  :8001
    ACA-Py Verifier:8021
    Accumulator    :8080
    VG             :4000
    Governance     :3000
    Rekor          :3000 (svc)
    VON Webserver  :9000 (svc) / :8000 (k8s internal)

WebSocket /ws  — streams ALL events to the frontend in real-time
POST /webhooks/{topic} — ingests ACA-Py webhook events

Start:
  pip install fastapi uvicorn httpx websockets python-dotenv
  uvicorn ssi_gateway:app --host 0.0.0.0 --port 8888 --reload

Port-forwards needed (one terminal each):
  kubectl port-forward svc/holder-agent          8031:8031 -n ssi-network
  kubectl port-forward svc/issuer-agent          8001:8001 -n ssi-network
  kubectl port-forward svc/verification-gateway  4000:4000 -n ssi-network
  kubectl port-forward svc/verification-gateway  8021:8021 -n ssi-network
  kubectl port-forward svc/governance-service    3000:3000 -n ssi-network
  kubectl port-forward svc/accumulator-service   8080:8080 -n ssi-network
  kubectl port-forward svc/rekor-server          3100:3000 -n ssi-network
  kubectl port-forward svc/von-webserver         8000:8000 -n ssi-network
"""

import asyncio
import json
import time
import logging
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Set

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ssi-gateway")

# ── Service endpoints (localhost port-forwards) ───────────────────────────
HOLDER_URL  = os.getenv("HOLDER_URL",  "http://localhost:8031")
ISSUER_URL  = os.getenv("ISSUER_URL",  "http://localhost:8001")
VG_URL      = os.getenv("VG_URL",      "http://localhost:4000")
GOV_URL     = os.getenv("GOV_URL",     "http://localhost:3000")
ACC_URL     = os.getenv("ACC_URL",     "http://localhost:8080")
REKOR_URL   = os.getenv("REKOR_URL",   "http://localhost:3100")
VON_URL     = os.getenv("VON_URL",     "http://localhost:8000")
VERIFIER_ADMIN = os.getenv("VERIFIER_ADMIN", "http://localhost:8021")

VG_API_KEY  = os.getenv("VG_API_KEY",  "/zWgZdpBePIBiBbxVftRw6HjIyMFFb/u1tkpYqzxUiY=")
ACC_API_KEY = os.getenv("ACC_API_KEY", "/zWgZdpBePIBiBbxVftRw6HjIyMFFb/u1tkpYqzxUiY=")

HEADERS_VG  = {"x-api-key": VG_API_KEY,  "Content-Type": "application/json"}
HEADERS_ACC = {"x-api-key": ACC_API_KEY, "Content-Type": "application/json"}

# ── WebSocket manager ─────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)
        log.info(f"WS connected ({len(self.active)} total)")

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)
        log.info(f"WS disconnected ({len(self.active)} remaining)")

    async def broadcast(self, data: Dict):
        if not self.active:
            return
        msg = json.dumps(data)
        dead = set()
        for ws in list(self.active):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        self.active -= dead

manager = ConnectionManager()

async def emit(event_type: str, payload: Dict, source: str = "gateway"):
    event = {
        "type":      event_type,
        "source":    source,
        "payload":   payload,
        "timestamp": time.time(),
    }
    log.info(f"EVENT {event_type} from {source}")
    await manager.broadcast(event)

# ── HTTP client ───────────────────────────────────────────────────────────
http: httpx.AsyncClient = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http
    http = httpx.AsyncClient(timeout=10.0)
    log.info("SSI Gateway started")
    # Start background health poller
    task = asyncio.create_task(poll_services())
    yield
    task.cancel()
    await http.aclose()
    log.info("SSI Gateway stopped")

async def poll_services():
    """Poll service health every 15s and broadcast status updates."""
    services = [
        ("accumulator", f"{ACC_URL}/health"),
        ("verification_gateway", f"{VG_URL}/health"),
        ("governance", f"{GOV_URL}/health"),
        ("von_ledger", f"{VON_URL}/"),
        ("rekor", f"{REKOR_URL}/api/v1/log"),
        ("issuer_agent", f"{ISSUER_URL}/status"),
        ("holder_agent", f"{HOLDER_URL}/status"),
    ]
    while True:
        status = {}
        for name, url in services:
            try:
                r = await http.get(url, timeout=3.0)
                status[name] = {"up": r.status_code < 400, "code": r.status_code}
            except Exception as e:
                status[name] = {"up": False, "error": str(e)[:60]}

        await emit("service_health", status, "gateway")
        await asyncio.sleep(15)

# ── App ───────────────────────────────────────────────────────────────────
app = FastAPI(title="SSI Gateway API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── WebSocket ─────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    # Send initial snapshot
    await send_snapshot(ws)
    try:
        while True:
            data = await ws.receive_text()
            # Client can send {"type": "ping"} to keep alive
            if data:
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await ws.send_text(json.dumps({"type": "pong", "timestamp": time.time()}))
                    elif msg.get("type") == "request_snapshot":
                        await send_snapshot(ws)
                except Exception:
                    pass
    except WebSocketDisconnect:
        manager.disconnect(ws)

async def send_snapshot(ws: WebSocket):
    """Send a full state snapshot to a newly connected client."""
    try:
        acc = await http.get(f"{ACC_URL}/accumulator/state", headers=HEADERS_ACC, timeout=3.0)
        await ws.send_text(json.dumps({
            "type": "snapshot_accumulator", "source": "accumulator",
            "payload": acc.json(), "timestamp": time.time()
        }))
    except Exception as e:
        log.warning(f"Snapshot acc failed: {e}")

    try:
        creds = await http.get(f"{HOLDER_URL}/credentials", timeout=3.0)
        await ws.send_text(json.dumps({
            "type": "snapshot_wallet", "source": "holder_agent",
            "payload": creds.json(), "timestamp": time.time()
        }))
    except Exception as e:
        log.warning(f"Snapshot wallet failed: {e}")

# ── ACA-Py Webhook Ingestor ───────────────────────────────────────────────
@app.api_route("/webhooks/topic/{topic}/", methods=["GET", "POST", "PUT", "DELETE"])
async def acapy_webhook(topic: str, request: Request):
    """
    ACA-Py posts webhook events here.
    Configure ACA-Py with --webhook-url http://ssi-gateway:8888/webhooks
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    # Map ACA-Py topics to frontend event types
    EVENT_MAP = {
        "issue_credential":       "credential_issued",
        "issue_credential_v2_0":  "credential_issued",
        "present_proof":          "proof_event",
        "present_proof_v2_0":     "proof_event",
        "connections":            "connection_event",
        "revocation_registry":    "revocation_update",
        "basicmessages":          "message_received",
    }

    event_type = EVENT_MAP.get(topic, f"acapy_{topic}")
    await emit(event_type, {"topic": topic, **payload}, "acapy")

    # For proof events specifically, trigger accumulator state refresh
    if topic.startswith("present_proof"):
        state = payload.get("state", "")
        if state in ("verified", "presentation_received"):
            try:
                acc_r = await http.get(f"{ACC_URL}/accumulator/state", headers=HEADERS_ACC, timeout=3.0)
                await emit("accumulator_update", acc_r.json(), "accumulator")
            except Exception:
                pass

    return {"status": "ok", "topic": topic}

# ════════════════════════════════════════════════════════════════════════
# HOLDER endpoints
# ════════════════════════════════════════════════════════════════════════

@app.get("/holder/credentials")
async def get_holder_credentials():
    """Fetch credentials from the holder agent wallet."""
    try:
        r = await http.get(f"{HOLDER_URL}/credentials", timeout=8.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, f"Holder agent unreachable: {e}")

@app.get("/holder/connections")
async def get_holder_connections():
    try:
        r = await http.get(f"{HOLDER_URL}/connections", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, f"Holder agent unreachable: {e}")

@app.get("/holder/credential-offers")
async def get_credential_offers():
    """Pending credential offers waiting for holder acceptance."""
    try:
        r = await http.get(f"{HOLDER_URL}/issue-credential-2.0/records?state=offer-received", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/holder/accept-offer/{cred_ex_id}")
async def accept_credential_offer(cred_ex_id: str):
    """Holder accepts a pending credential offer."""
    try:
        r = await http.post(f"{HOLDER_URL}/issue-credential-2.0/records/{cred_ex_id}/send-request", timeout=8.0)
        data = r.json()
        await emit("credential_accepted", {"cred_ex_id": cred_ex_id, **data}, "holder")
        return data
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/holder/proof-requests")
async def get_proof_requests():
    """Pending proof requests waiting for holder response."""
    try:
        r = await http.get(f"{HOLDER_URL}/present-proof-2.0/records?state=request-received", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

class SendProofRequest(BaseModel):
    pres_ex_id: str
    self_attested: Optional[Dict[str, str]] = {}
    requested_attrs: Optional[Dict[str, Dict]] = {}

@app.post("/holder/send-proof")
async def send_proof(req: SendProofRequest):
    """Holder sends a proof presentation in response to a request."""
    try:
        # Build presentation from available credentials
        records = await http.get(
            f"{HOLDER_URL}/present-proof-2.0/records/{req.pres_ex_id}/credentials",
            timeout=5.0
        )
        indy_body = {
            "self_attested_attributes": req.self_attested,
            "requested_attributes": {},
            "requested_predicates": {}
        }
        # Auto-select first matching credential for each referent
        for cred_ref in records.json():
            ref = cred_ref.get("presentation_referents", [])
            cred_info = cred_ref.get("cred_info", {})
            for r_ref in ref:
                indy_body["requested_attributes"][r_ref] = {
                    "cred_id": cred_info["referent"],
                    "revealed": True
                }

        # v2 API requires format wrapping
        body = {"indy": indy_body}

        log.info(f"Sending presentation for {req.pres_ex_id}: {list(indy_body['requested_attributes'].keys())}")
        r = await http.post(
            f"{HOLDER_URL}/present-proof-2.0/records/{req.pres_ex_id}/send-presentation",
            json=body, timeout=10.0
        )
        if r.status_code >= 400:
            log.error(f"send-presentation failed ({r.status_code}): {r.text}")
            raise HTTPException(r.status_code, r.text)
        data = r.json()
        await emit("proof_sent", {"pres_ex_id": req.pres_ex_id, **data}, "holder")
        return data
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"send-proof exception: {e}")
        raise HTTPException(502, str(e))

# ════════════════════════════════════════════════════════════════════════
# ISSUER endpoints
# ════════════════════════════════════════════════════════════════════════

@app.get("/issuer/schemas")
async def get_schemas():
    try:
        r = await http.get(f"{ISSUER_URL}/schemas/created", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/issuer/credential-definitions")
async def get_cred_defs():
    try:
        r = await http.get(f"{ISSUER_URL}/credential-definitions/created", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/issuer/connections")
async def get_issuer_connections():
    """Return ALL connections so the issuer can see pending invitations too."""
    try:
        r = await http.get(f"{ISSUER_URL}/connections", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/issuer/create-invitation")
async def create_invitation():
    """Create an OOB invitation. Holder pastes/scans this to connect."""
    try:
        r = await http.post(
            f"{ISSUER_URL}/out-of-band/create-invitation",
            json={"handshake_protocols": ["https://didcomm.org/didexchange/1.0"], "use_public_did": False},
            timeout=8.0,
        )
        data = r.json()
        await emit("invitation_created", {"url_prefix": str(data.get("invitation_url",""))[:60]}, "issuer")
        return data
    except Exception as e:
        raise HTTPException(502, str(e))

@app.post("/holder/receive-invitation")
async def receive_invitation(request: Request):
    """Holder pastes an invitation JSON or URL to connect to issuer."""
    body = await request.json()
    inv  = body.get("invitation", body)

    # Handle OOB URL decoding
    if isinstance(inv, str) and "oob=" in inv:
        import base64
        try:
            b64 = inv.split("oob=")[1].split("&")[0]
            b64 += "=" * ((4 - len(b64) % 4) % 4)
            inv = json.loads(base64.urlsafe_b64decode(b64))
        except Exception as e:
            raise HTTPException(400, f"Failed to decode OOB URL: {e}")

    try:
        r = await http.post(
            f"{HOLDER_URL}/out-of-band/receive-invitation?auto_accept=true",
            json=inv,
            timeout=10.0,
        )
        data = r.json()
        await emit("connection_event", {"state": "invitation-received", "role": "holder"}, "holder")
        return data
    except Exception as e:
        raise HTTPException(502, str(e))

class SchemaRequest(BaseModel):
    schema_name:    str
    schema_version: str = "1.0"
    attributes:     List[str]

@app.post("/issuer/publish-schema")
async def publish_schema(req: SchemaRequest):
    """Step 1: publish a new schema to the Indy ledger."""
    body = {"schema_name": req.schema_name, "schema_version": req.schema_version, "attributes": req.attributes}
    try:
        r = await http.post(f"{ISSUER_URL}/schemas", json=body, timeout=30.0)
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        data = r.json()
        await emit("schema_published", {"schema_id": data.get("schema_id"), "name": req.schema_name}, "issuer")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))

class CredDefRequest(BaseModel):
    schema_id:          str
    tag:                str = "default"
    support_revocation: bool = False

@app.post("/issuer/publish-cred-def")
async def publish_cred_def(req: CredDefRequest):
    """Step 2: publish credential definition for a schema (needed before issuing)."""
    body = {"schema_id": req.schema_id, "tag": req.tag, "support_revocation": req.support_revocation}
    try:
        r = await http.post(f"{ISSUER_URL}/credential-definitions", json=body, timeout=30.0)
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        data = r.json()
        await emit("cred_def_published", {"cred_def_id": data.get("credential_definition_id")}, "issuer")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/issuer/schemas-full")
async def get_schemas_full():
    """Return schemas with attribute lists for the UI."""
    try:
        ids_r = await http.get(f"{ISSUER_URL}/schemas/created", timeout=5.0)
        ids   = ids_r.json().get("schema_ids", [])
        schemas = []
        for sid in ids:
            try:
                d = await http.get(f"{ISSUER_URL}/schemas/{sid}", timeout=5.0)
                schemas.append(d.json().get("schema", {"id": sid}))
            except Exception:
                schemas.append({"id": sid})
        return {"schemas": schemas}
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/issuer/issued")
async def get_issued_credentials():
    try:
        r = await http.get(f"{ISSUER_URL}/issue-credential-2.0/records", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

class IssueRequest(BaseModel):
    connection_id: str
    cred_def_id:   str
    attributes:    Dict[str, str]   # {"name": "Alice", "degree": "BSc"}
    comment:       Optional[str] = "Credential issued via SSI Gateway"

@app.post("/issuer/issue")
async def issue_credential(req: IssueRequest):
    """Issue a verifiable credential to a connected holder."""
    attrs = [{"name": k, "value": v} for k, v in req.attributes.items()]
    body = {
        "auto_remove": False,
        "comment": req.comment,
        "connection_id": req.connection_id,
        "credential_preview": {
            "@type": "issue-credential/2.0/credential-preview",
            "attributes": attrs
        },
        "filter": {"indy": {"cred_def_id": req.cred_def_id}},
        "trace": False
    }
    try:
        r = await http.post(f"{ISSUER_URL}/issue-credential-2.0/send-offer", json=body, timeout=10.0)
        data = r.json()
        cred_ex_id = data.get("cred_ex_id") or data.get("credential_exchange_id", "")

        # Register in accumulator
        cred_hash = _make_hash(cred_ex_id)
        try:
            await http.post(
                f"{ACC_URL}/accumulator/add",
                json={"cred_hash": cred_hash, "issuer_id": "issuer-agent"},
                headers=HEADERS_ACC, timeout=5.0
            )
        except Exception as ae:
            log.warning(f"Accumulator add failed: {ae}")

        await emit("credential_issued", {
            "cred_ex_id": cred_ex_id,
            "connection_id": req.connection_id,
            "cred_def_id": req.cred_def_id,
            "attributes": req.attributes,
            "cred_hash": cred_hash,
        }, "issuer")
        return {**data, "cred_hash": cred_hash}
    except Exception as e:
        raise HTTPException(502, str(e))

class RevokeRequest(BaseModel):
    cred_ex_id:   str
    issuer_id:    Optional[str] = "issuer-agent"

@app.post("/issuer/revoke")
async def revoke_credential(req: RevokeRequest):
    """
    Revoke a credential:
    1. Remove from accumulator (triggers fraud detector)
    2. Post to VG governance (requires k-of-n votes in production)
    3. Emit event
    """
    cred_hash = _make_hash(req.cred_ex_id)
    results = {}

    # Step 1: accumulator revoke
    try:
        r = await http.post(
            f"{ACC_URL}/accumulator/revoke",
            json={"cred_hash": cred_hash, "issuer_id": req.issuer_id},
            headers=HEADERS_ACC, timeout=5.0
        )
        results["accumulator"] = r.json()
    except Exception as e:
        results["accumulator"] = {"error": str(e)}

    await emit("revocation_update", {
        "cred_ex_id": req.cred_ex_id,
        "cred_hash": cred_hash,
        "results": results
    }, "issuer")

    return results

def _make_hash(s: str) -> str:
    import hashlib
    return hashlib.sha256(s.encode()).hexdigest()

# ════════════════════════════════════════════════════════════════════════
# VERIFIER / RELYING PARTY endpoints
# ════════════════════════════════════════════════════════════════════════

@app.get("/verifier/connections")
async def get_verifier_connections():
    """Fetch connections for the verifier agent."""
    try:
        r = await http.get(f"{VERIFIER_ADMIN}/connections", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, f"Verifier agent unreachable: {e}")

@app.post("/verifier/invitation")
async def create_verifier_invitation():
    """Generate a multi-use OOB invitation for the verifier."""
    try:
        r = await http.post(
            f"{VERIFIER_ADMIN}/out-of-band/create-invitation",
            json={"handshake_protocols": ["https://didcomm.org/didexchange/1.0"], "use_public_did": False},
            timeout=8.0
        )
        return r.json()
    except Exception as e:
        raise HTTPException(502, f"Verifier agent unreachable: {e}")

# In-memory challenge store (production: Redis)
_challenges: Dict[str, Dict] = {}

@app.post("/verifier/challenge")
async def issue_challenge():
    """
    RP Step 1: Issue a cryptographically random challenge (2FA-style nonce).
    The holder must embed this nonce in their VP.
    """
    nonce = secrets.token_hex(32)
    code  = secrets.token_hex(3).upper()   # 6-char human-readable code for display
    _challenges[nonce] = {
        "nonce":      nonce,
        "code":       code,
        "issued_at":  time.time(),
        "expires_at": time.time() + 300,
        "consumed":   False,
        "status":     "PENDING",
    }
    await emit("challenge_issued", {"nonce": nonce[:16] + "…", "code": code}, "relying_party")
    return {"nonce": nonce, "code": code, "expires_in": 300}

class ProofRequestBody(BaseModel):
    connection_id:        str
    nonce:                str
    requested_attributes: Dict[str, Any]
    requested_predicates: Optional[Dict[str, Any]] = {}
    name:                 Optional[str] = "Verification Request"
    version:              Optional[str] = "1.0"

@app.post("/verifier/request-proof")
async def request_proof(req: ProofRequestBody):
    """
    RP Step 2: Send a proof request (with the challenge nonce embedded).
    Routes through the Verification Gateway.
    """
    ch = _challenges.get(req.nonce)
    if not ch:
        raise HTTPException(400, "Unknown challenge nonce — issue a challenge first")
    if time.time() > ch["expires_at"]:
        raise HTTPException(400, "Challenge expired")
    if ch["consumed"]:
        raise HTTPException(409, "Challenge already used — replay detected")

    # Indy requires nonces to be decimal integer strings (not hex)
    indy_nonce = str(int(req.nonce, 16))

    proof_req_data = {
        "name":    req.name,
        "version": req.version,
        "nonce":   indy_nonce,
        "requested_attributes":  req.requested_attributes,
        "requested_predicates":  req.requested_predicates or {},
    }

    try:
        log.info(f"Sending proof request to VG: connection_id={req.connection_id}, nonce={indy_nonce[:20]}...")
        r = await http.post(
            f"{VG_URL}/verify",
            json={
                "connection_id": req.connection_id,
                "proof_request_data": proof_req_data
            },
            headers=HEADERS_VG, timeout=15.0
        )
        if r.status_code >= 400:
            detail = r.text
            log.error(f"VG /verify failed ({r.status_code}): {detail}")
            raise HTTPException(r.status_code, f"Verification Gateway error: {detail}")

        data = r.json()
        exchange_id = data.get("presentation_exchange_id", "")
        log.info(f"Proof request created: exchange_id={exchange_id}")

        ch["status"]      = "REQUESTED"
        ch["exchange_id"] = exchange_id
        ch["consumed"]    = True

        await emit("proof_requested", {
            "exchange_id":  exchange_id,
            "connection_id": req.connection_id,
            "nonce_code":   ch["code"],
        }, "relying_party")

        return {**data, "challenge_code": ch["code"]}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"VG /verify exception: {e}")
        raise HTTPException(502, str(e))

@app.get("/verifier/result/{exchange_id}")
async def get_verification_result(exchange_id: str):
    """Poll for verification result + threshold token."""
    try:
        # Check ACA-Py verifier
        r = await http.get(
            f"{VERIFIER_ADMIN}/present-proof-2.0/records/{exchange_id}",
            timeout=5.0
        )
        record = r.json()

        # Try to get threshold token
        token_data = None
        try:
            t = await http.get(
                f"{VG_URL}/verify-token/{exchange_id}",
                headers=HEADERS_VG, timeout=3.0
            )
            if t.status_code == 200:
                token_data = t.json()
        except Exception:
            pass

        return {
            "exchange_id":     exchange_id,
            "state":           record.get("state"),
            "verified":        record.get("verified"),
            "presentation":    record.get("presentation", {}),
            "threshold_token": token_data,
        }
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/verifier/exchanges")
async def list_exchanges():
    try:
        r = await http.get(f"{VERIFIER_ADMIN}/present-proof/records", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

# ════════════════════════════════════════════════════════════════════════
# ACCUMULATOR / DB endpoints
# ════════════════════════════════════════════════════════════════════════

@app.get("/accumulator/state")
async def acc_state():
    r = await http.get(f"{ACC_URL}/accumulator/state", headers=HEADERS_ACC, timeout=5.0)
    return r.json()

@app.get("/accumulator/log")
async def acc_log():
    r = await http.get(f"{ACC_URL}/accumulator/export", headers=HEADERS_ACC, timeout=8.0)
    return r.json()

@app.get("/accumulator/alerts")
async def acc_alerts():
    r = await http.get(f"{ACC_URL}/fraud/alerts", headers=HEADERS_ACC, timeout=5.0)
    return r.json()

@app.get("/accumulator/analysis")
async def acc_analysis():
    r = await http.get(f"{ACC_URL}/fraud/analysis", timeout=5.0)
    return r.json()

@app.get("/transparency/log")
async def transparency_log(limit: int = 20):
    try:
        r = await http.get(f"{REKOR_URL}/api/v1/log", timeout=5.0)
        log_info = r.json()
        entries = []
        tree_size = int(log_info.get("treeSize", log_info.get("TreeSize", 0)))
        for i in range(max(0, tree_size - limit), tree_size):
            try:
                e = await http.get(f"{REKOR_URL}/api/v1/log/entries?logIndex={i}", timeout=3.0)
                if e.status_code == 200:
                    entries.append({"index": i, "data": e.json()})
            except Exception:
                pass
        return {"tree_size": tree_size, "entries": entries}
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/ledger/transactions")
async def ledger_transactions(page: int = 1, page_size: int = 20):
    try:
        r = await http.get(f"{VON_URL}/ledger/domain?page={page}&pageSize={page_size}", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

@app.get("/ledger/status")
async def ledger_status():
    try:
        r = await http.get(f"{VON_URL}/status", timeout=5.0)
        return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))

# ── Health ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "ws_connections": len(manager.active), "timestamp": time.time()}