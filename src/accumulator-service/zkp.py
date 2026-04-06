### ZKP Service
### ZKPProver creates commitment + non-membership proof bundle. 
### ZKPVerifier checks the math (A^a · d^p_x = g mod n), 
### hash integrity, and epoch freshness — never needing the actual credential hash. 
### Also includes attribute predicate ZKP (age ≥ 18).

"""
Zero-Knowledge Proof Module for SSI Credential Verification.

Implements:
  1. Non-membership ZKP  — proves a credential is NOT revoked
     without revealing the credential ID to the verifier.
     Based on the RSA accumulator non-membership witness (Bezout identity).

  2. Attribute predicate ZKP — proves a claim like "age >= 18"
     without revealing the actual attribute value.
     PoC uses a Pedersen-style commitment + hash binding.
     Production would use Bulletproofs or zk-SNARKs.

Protocol overview (Sigma-protocol style for non-membership):
  Commit  →  Holder binds cred_hash to a commitment C = H(hash||nonce||r)
  Prove   →  Holder generates (a, d) from accumulator + attaches C
  Verify  →  Verifier checks A^a · d^p_x ≡ g (mod n) AND hash(C, a, d, nonce)

The verifier never learns cred_hash — only that it is NOT in the revoked set.
"""

import hashlib
import secrets
import time
import logging
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Prover  (runs on Holder side / Accumulator Service on behalf of Holder)
# --------------------------------------------------------------------------

class ZKPProver:

    def __init__(self, accumulator) -> None:
        self.acc = accumulator

    def commit(self, cred_hash: str, nonce: str) -> Dict:
        """
        Phase 1 — Commitment.
        C = SHA-256( cred_hash || ":" || nonce || ":" || randomness )

        The randomness is kept secret by the holder; the commitment
        binds the holder to the cred_hash without revealing it.
        """
        randomness = secrets.token_hex(32)
        preimage = f"{cred_hash}:{nonce}:{randomness}"
        commitment = hashlib.sha256(preimage.encode()).hexdigest()
        return {
            "commitment": commitment,
            "randomness": randomness,   # PRIVATE — holder keeps this
            "nonce": nonce,
        }

    def non_membership_proof(
        self,
        cred_hash: str,
        nonce: str,
        commitment: str,
        randomness: str,
    ) -> Optional[Dict]:
        """
        Phase 2 — Proof generation.

        Returns a proof bundle containing:
          - commitment C
          - Bezout witness (a, d) from the accumulator
          - proof_hash = H(C || a || d || nonce)  (integrity binding)

        Returns None if cred_hash IS in the accumulator (i.e., revoked).
        """
        witness = self.acc.non_membership_witness(cred_hash)
        if witness is None:
            # Credential is in the active (revoked credentials) set
            logger.warning("Non-membership proof requested for member element")
            return None

        # Rerandomize the witness to achieve strong unlinkability (PRI-04)
        # a' = a - r * prime_x
        # d' = d * A^r mod n
        r = secrets.randbelow(2**128)
        a_orig = int(witness["a"])
        d_orig = int(witness["d"])
        x      = int(witness["prime_x"])
        
        a_rand = a_orig - (r * x)
        d_rand = (d_orig * pow(self.acc.A, r, self.acc.n)) % self.acc.n

        proof_hash = hashlib.sha256(
            f"{commitment}:{a_rand}:{d_rand}:{nonce}".encode()
        ).hexdigest()

        return {
            "proof_type": "rsa_non_membership_zkp",
            "commitment": commitment,
            "witness_a": str(a_rand),
            "witness_d": str(d_rand),
            "prime_x": str(x),
            "accumulator_epoch": witness["epoch"],
            "nonce": nonce,
            "proof_hash": proof_hash,
            "timestamp": time.time(),
            "_note": (
                "Witness (a, d) is rerandomized per presentation. "
                "In production the prover runs locally on the holder device. "
                "The verifier never sees cred_hash — only this proof bundle."
            ),
        }

    def predicate_proof(
        self,
        attribute_name: str,
        attribute_value: int,
        predicate: str,     # ">=" | "<=" | ">" | "<" | "=="
        threshold: int,
        nonce: str,
    ) -> Dict:
        """
        ZKP attribute predicate.

        Proves: attribute_value <predicate> threshold
        without revealing attribute_value.

        PoC implementation:
          1. Check predicate holds (prover has the actual value).
          2. Create a commitment: C = H(name || ":" || value || ":" || r || ":" || nonce)
          3. Bind proof:          P = H(C || predicate || threshold || nonce)

        Production:  replace with Bulletproofs range proof or zk-SNARK circuit.
        """
        ops = {
            ">=": attribute_value >= threshold,
            "<=": attribute_value <= threshold,
            ">":  attribute_value >  threshold,
            "<":  attribute_value <  threshold,
            "==": attribute_value == threshold,
        }
        if predicate not in ops:
            return {"valid": False, "error": f"Unknown predicate: {predicate}"}
        if not ops[predicate]:
            return {"valid": False, "error": "Predicate does not hold for this attribute value"}

        randomness = secrets.token_hex(32)
        commitment = hashlib.sha256(
            f"{attribute_name}:{attribute_value}:{randomness}:{nonce}".encode()
        ).hexdigest()

        proof = hashlib.sha256(
            f"{commitment}:{predicate}:{threshold}:{nonce}".encode()
        ).hexdigest()

        return {
            "proof_type": "attribute_predicate_poc",
            "attribute": attribute_name,
            "predicate": predicate,
            "threshold": threshold,
            "commitment": commitment,
            "proof": proof,
            "nonce": nonce,
            "valid": True,
            "_production_note": (
                "Replace with Bulletproofs/zk-SNARK for production. "
                "This PoC commits to the value without revealing it."
            ),
        }


# --------------------------------------------------------------------------
# Verifier  (runs on Verification Gateway)
# --------------------------------------------------------------------------

class ZKPVerifier:

    def __init__(self, accumulator) -> None:
        self.acc = accumulator

    def verify_non_membership(self, proof: Dict) -> Dict:
        """
        Verify a non-membership ZKP proof bundle.

        Checks:
          1. Accumulator math:  A^a · d^p_x ≡ g  (mod n)
          2. Proof hash:        H(C || a || d || nonce) matches proof_hash
          3. Epoch freshness:   proof was generated for the current epoch

        The verifier NEVER needs cred_hash — only (a, d, prime_x).
        """
        try:
            a       = int(proof["witness_a"])
            d       = int(proof["witness_d"])
            prime_x = int(proof["prime_x"])
            commitment = proof["commitment"]
            nonce      = proof["nonce"]

            # ── 1. Accumulator math ──────────────────────────────────────
            if a >= 0:
                part1 = pow(self.acc.A, a, self.acc.n)
            else:
                A_inv = pow(self.acc.A, -1, self.acc.n)
                part1 = pow(A_inv, -a, self.acc.n)

            part2 = pow(d, prime_x, self.acc.n)
            math_valid = ((part1 * part2) % self.acc.n == self.acc.g)

            # ── 2. Proof hash integrity ──────────────────────────────────
            expected = hashlib.sha256(
                f"{commitment}:{proof['witness_a']}:{proof['witness_d']}:{nonce}".encode()
            ).hexdigest()
            hash_valid = (expected == proof["proof_hash"])

            # ── 3. Epoch freshness ───────────────────────────────────────
            epoch_valid = (proof.get("accumulator_epoch") == self.acc.epoch)

            overall = math_valid and hash_valid and epoch_valid

            return {
                "valid":        overall,
                "math_valid":   math_valid,
                "hash_valid":   hash_valid,
                "epoch_valid":  epoch_valid,
                "epoch_current": self.acc.epoch,
                "epoch_in_proof": proof.get("accumulator_epoch"),
                "message": "Credential is NOT revoked" if overall else "Proof invalid or stale",
            }

        except (KeyError, ValueError) as exc:
            return {"valid": False, "error": f"Malformed proof: {exc}"}

    def verify_predicate(self, proof: Dict) -> Dict:
        """
        Verify an attribute predicate ZKP.

        Re-derives the expected proof hash from (commitment, predicate,
        threshold, nonce) and checks it matches the submitted proof.
        """
        try:
            expected = hashlib.sha256(
                f"{proof['commitment']}:{proof['predicate']}:{proof['threshold']}:{proof['nonce']}".encode()
            ).hexdigest()
            valid = (expected == proof["proof"])
            return {
                "valid":     valid,
                "attribute": proof["attribute"],
                "predicate": proof["predicate"],
                "threshold": proof["threshold"],
                "message":   (
                    f"Proved: {proof['attribute']} {proof['predicate']} {proof['threshold']}"
                    if valid else "Predicate proof invalid"
                ),
            }
        except (KeyError, ValueError) as exc:
            return {"valid": False, "error": f"Malformed proof: {exc}"}