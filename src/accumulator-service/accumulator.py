### Accumulator Service
### Full RSA dynamic accumulator. Implements add, revoke, 
### membership witness (W^p = A mod n), 
### and non-membership witness via Bezout's identity (a·p_x + b·P = 1). 
### Append-only state log.

"""
RSA-Based Dynamic Cryptographic Accumulator for SSI Revocation.

Reference: Baric & Pfitzmann (1997), Li et al. (2007) dynamic accumulators.
Implements:
  - Dynamic membership (add/remove elements)
  - Membership witnesses: W_x = g^(∏ primes \ p_x) mod n
    Verification:         W_x ^ p_x ≡ A (mod n)
  - Non-membership witnesses via Bezout's identity:
    Find a, b s.t.  a·p_x + b·∏_members = 1  (Bezout, gcd=1 guaranteed)
    d = g^b mod n
    Verification: A^a · d^p_x ≡ g (mod n)

Security note:
  1024-bit modulus is used for PoC speed.
  Production MUST use 2048-bit or higher.
"""

import hashlib
import json
import time
import logging
from dataclasses import dataclass, field, asdict
from typing import Optional, Tuple, Dict, List

from sympy import nextprime, gcdex

logger = logging.getLogger(__name__)


@dataclass
class AccumulatorParams:
    n: int   # RSA modulus  (public)
    g: int   # Generator    (quadratic residue mod n, public)


@dataclass
class LogEntry:
    epoch: int
    operation: str          # ADD | REVOKE
    element_prefix: str     # First 16 chars of hash (privacy-safe logging)
    timestamp: float
    accumulator_prefix: str # First 32 chars of accumulator value


class RSAAccumulator:
    """
    Dynamic RSA accumulator.

    State:
        A  = g^(p1 * p2 * ... * pk) mod n
        where pi = hash_to_prime(credential_hash_i)

    The state_log is append-only — it records every ADD and REVOKE
    to satisfy the tamper-evident audit requirement.
    """

    def __init__(self, params: AccumulatorParams) -> None:
        self.n: int = params.n
        self.g: int = params.g
        self.A: int = params.g                  # Current accumulator value
        self.members: Dict[str, int] = {}       # cred_hash → prime
        self.epoch: int = 0
        self.state_log: List[LogEntry] = []     # append-only

    # ------------------------------------------------------------------
    # Hashing
    # ------------------------------------------------------------------

    def hash_to_prime(self, element: str) -> int:
        """
        Deterministically map a string to a prime number.

        Method:
          1. SHA-256 the input
          2. Interpret as integer, reduce to 128-bit range
          3. Find the next prime ≥ that integer

        The 128-bit range keeps exponent products manageable for PoC
        while still providing strong collision resistance.
        """
        raw = int(hashlib.sha256(element.encode("utf-8")).hexdigest(), 16)
        # Fix to 128-bit space with the high bit set to ensure 128-bit size
        reduced = (raw % (2 ** 128)) | (2 ** 127)
        prime = int(nextprime(reduced))
        return prime

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def add(self, cred_hash: str) -> Dict:
        """
        Add credential hash to accumulator.
        A_new = A_old ^ prime(cred_hash) mod n
        """
        if cred_hash in self.members:
            return {"error": "Already a member", "epoch": self.epoch}

        p = self.hash_to_prime(cred_hash)
        self.members[cred_hash] = p
        self.A = pow(self.A, p, self.n)
        self.epoch += 1
        self._append_log("ADD", cred_hash)

        return {
            "success": True,
            "epoch": self.epoch,
            "accumulator": str(self.A),
            "member_count": len(self.members),
        }

    def revoke(self, cred_hash: str) -> Dict:
        """
        Remove credential hash from accumulator (revocation).

        Recomputes A from scratch over the remaining member set.
        The old A value is preserved in the append-only state log.
        """
        if cred_hash not in self.members:
            return {"error": "Not a member — cannot revoke"}

        del self.members[cred_hash]

        # Recompute: A = g^(∏ remaining primes) mod n
        self.A = self.g
        for p in self.members.values():
            self.A = pow(self.A, p, self.n)

        self.epoch += 1
        self._append_log("REVOKE", cred_hash)

        return {
            "success": True,
            "epoch": self.epoch,
            "accumulator": str(self.A),
            "member_count": len(self.members),
        }

    # ------------------------------------------------------------------
    # Witnesses
    # ------------------------------------------------------------------

    def membership_witness(self, cred_hash: str) -> Optional[Dict]:
        """
        Compute membership witness W_x for cred_hash.

        W_x = g^(∏_{e ≠ x} prime(e)) mod n
        Verify:  W_x ^ prime(x) ≡ A  (mod n)
        """
        if cred_hash not in self.members:
            return None

        p_x = self.members[cred_hash]

        other_product = 1
        for h, p in self.members.items():
            if h != cred_hash:
                other_product *= p

        W = pow(self.g, other_product, self.n)

        return {
            "witness": str(W),
            "prime": str(p_x),
            "epoch": self.epoch,
            "accumulator": str(self.A),
        }

    def verify_membership(self, cred_hash: str, witness: int) -> bool:
        """Verify  W ^ prime(cred_hash) ≡ A  (mod n)."""
        p = self.hash_to_prime(cred_hash)
        return pow(witness, p, self.n) == self.A

    def non_membership_witness(self, cred_hash: str) -> Optional[Dict]:
        """
        Compute non-membership (Bezout) witness.

        For x NOT in {members}:
          Let P = ∏ prime(m) for m in members
          gcd(prime_x, P) = 1  (prime_x is prime and not a factor of P)

        Bezout:  a·prime_x + b·P = 1

        Witness: d = g^b mod n  (handle negative b via modular inverse)
        Verify:  A^a · d^prime_x ≡ g  (mod n)

        This is the mathematical core of the ZKP revocation proof.
        """
        if cred_hash in self.members:
            # Element IS in accumulator — non-membership witness impossible
            return None

        p_x = self.hash_to_prime(cred_hash)

        if not self.members:
            # Empty accumulator: trivial non-membership
            return {
                "a": "0",
                "d": "1",
                "prime_x": str(p_x),
                "epoch": self.epoch,
                "trivial": True,
            }

        # Product of all member primes
        P = 1
        for p in self.members.values():
            P *= p

        # Extended GCD: s·prime_x + t·P = gcd = 1
        s, t, gcd_val = gcdex(p_x, P)
        # Verification checks: A^a · d^p_x ≡ g (mod n)
        # Expanding: g^(P·a) · g^(b·p_x) = g^(P·a + b·p_x) = g^1
        # So we need: P·a + b·p_x = 1  →  a = t, b = s  (NOT a=s, b=t)
        a, b = int(t), int(s)

        if gcd_val != 1:
            logger.error("gcd != 1, which should be impossible for a prime not in product")
            return None

        # Compute d = g^b mod n (handle b < 0 with modular inverse)
        if b >= 0:
            d = pow(self.g, b, self.n)
        else:
            g_inv = pow(self.g, -1, self.n)   # Python 3.8+ modular inverse
            d = pow(g_inv, -b, self.n)

        return {
            "a": str(a),
            "d": str(d),
            "prime_x": str(p_x),
            "epoch": self.epoch,
            "accumulator": str(self.A),
        }

    def verify_non_membership(self, cred_hash: str, a: int, d: int) -> bool:
        """
        Verify non-membership witness.
        Check:  A^a · d^prime_x ≡ g  (mod n)

        This is the verifier side of the ZKP revocation check.
        Crucially, the verifier does NOT need to know cred_hash —
        only prime_x (which can be sent as part of the proof).
        """
        p_x = self.hash_to_prime(cred_hash)

        # A^a mod n  (handle negative a)
        if a >= 0:
            part1 = pow(self.A, a, self.n)
        else:
            A_inv = pow(self.A, -1, self.n)
            part1 = pow(A_inv, -a, self.n)

        part2 = pow(d, p_x, self.n)
        return (part1 * part2) % self.n == self.g

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def _append_log(self, operation: str, cred_hash: str) -> None:
        entry = LogEntry(
            epoch=self.epoch,
            operation=operation,
            element_prefix=cred_hash[:16] + "…",
            timestamp=time.time(),
            accumulator_prefix=str(self.A)[:32] + "…",
        )
        self.state_log.append(entry)

    def export_state(self) -> Dict:
        return {
            "accumulator": str(self.A),
            "epoch": self.epoch,
            "member_count": len(self.members),
            "members": {k: str(v) for k, v in self.members.items()},
            "log": [asdict(e) for e in self.state_log],
        }

    def import_state(self, data: Dict) -> None:
        self.A = int(data["accumulator"])
        self.epoch = data["epoch"]
        self.members = {k: int(v) for k, v in data["members"].items()}
        self.state_log = [LogEntry(**e) for e in data.get("log", [])]