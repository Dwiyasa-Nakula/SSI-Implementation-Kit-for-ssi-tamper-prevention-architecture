from pydantic import BaseModel, field_validator
from typing import Optional, Dict, Any


class AddCredentialRequest(BaseModel):
    cred_hash: str
    issuer_id: Optional[str] = "unknown"
    metadata: Optional[Dict[str, Any]] = None

    @field_validator("cred_hash")
    @classmethod
    def hash_must_be_hex(cls, v: str) -> str:
        if len(v) < 16:
            raise ValueError("cred_hash must be at least 16 characters")
        return v


class RevokeCredentialRequest(BaseModel):
    cred_hash: str
    issuer_id: str
    reason: Optional[str] = None
    governance_token: Optional[str] = None   # token from Governance Service


class CreateZKPProofRequest(BaseModel):
    """
    In production the proof is generated fully on the holder device.
    For the PoC, the holder sends cred_hash to the service which
    generates the proof on their behalf.
    """
    cred_hash: str
    nonce: str   # challenge issued by the Relying Party


class VerifyZKPProofRequest(BaseModel):
    proof: Dict[str, Any]
    nonce: str
    presentation_id: Optional[str] = None


class PredicateProofRequest(BaseModel):
    attribute_name: str
    attribute_value: int
    predicate: str    # ">=" | "<=" | ">" | "<" | "=="
    threshold: int
    nonce: str


class VerifyPredicateRequest(BaseModel):
    proof: Dict[str, Any]


class ImportStateRequest(BaseModel):
    state: Dict[str, Any]
    admin_token: str