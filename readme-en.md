# SSI Revocation Protocol with Threshold Governance

**Decentralized Architecture for Self-Sovereign Identity (SSI) with Tamper-Prevention Mechanisms**

A proof-of-concept (PoC) implementation of a decentralized digital identity (Self-Sovereign Identity / SSI) revocation protocol utilizing **Threshold Governance** and Immutable Audit Logs (via **Sigstore Trillian/Rekor**). This project is designed to prevent unilateral revocation (tamper-prevention) by any single entity.
The system is built on **Kubernetes** orchestration and integrates industry security standards such as **RBAC**, **Distributed Rate Limiting**, **Threshold Signatures**, and **Immutable Audit Logs**.

---

## ✨ Key Features

### 1. Security & Tamper Prevention

- **Threshold Governance (k-of-n):** Prevents a *single point of compromise*. Credential revocation requires cryptographic signatures (Ed25519) from *k* independent validators before being written to the ledger.
- **Immutable Audit Trail:** Every successful verification is recorded in a **Transparency Log** (Merkle Tree-based via Trillian/Rekor) to ensure verification history cannot be secretly altered.
- **Zero-Trust Network:** Inter-service communication is restricted using **Kubernetes NetworkPolicies**. Only specific paths (e.g., Governance → Issuer) are allowed.
- **Secret Management:** Sensitive credentials (Wallet Keys, DB Passwords, JWT Secrets) are securely injected via Kubernetes Secrets instead of being hardcoded.

### 2. Performance & Reliability

- **Auto-Scaling (HPA):** The *Verification Gateway* and *Issuer Agent* automatically scale replicas (Pods) when CPU usage exceeds 60%.
- **Distributed Rate Limiting:** Uses **Redis** to synchronize rate limits across pod replicas, preventing global DoS (Denial of Service) attacks.
- **Graceful Shutdown:** Handles Kubernetes `SIGTERM` signals to close database connections and complete active requests before pod termination.

### 3. Privacy Preservation

- **Verifiable Credentials & ZKP:** Verification occurs without raw data exchange using the *Present Proof* protocol from Hyperledger Aries.
- **Sanitized Errors:** API responses are cleaned of sensitive stack traces to prevent information leakage.

---

## 📂 Project Structure

```text
ssi-production-kit/
│
├── k8s/                        # Kubernetes Infrastructure (Manifests)
│   └── deployment.yaml         # Full definitions: Deployments, Services, HPA, Secrets, NetworkPolicies
│
├── src/
│   ├── governance-service/     # Gatekeeper Service (Threshold Logic)
│   │   ├── index.js            # Core logic: Ed25519 Verify, Redis State, JWT Auth
│   │   ├── package.json        # Dependencies: helmet, redis, express
│   │   └── Dockerfile          # Container Image definition
│   │
│   └── verification-gateway/   # Verification & Audit Middleware
│       ├── index.js            # Core logic: Rate Limiting, Input Validation, Trillian Log
│       ├── package.json        # Dependencies: express-validator, rate-limit-redis
│       └── Dockerfile          # Container Image definition
│
└── README.md                   # Documentation
```

---

## 🏛️ System Architecture

![SSI Architecture](image/architechture-SSI-DID.png)

### Core Components & Technologies

1. **VDR (Verifiable Data Registry):** Uses Hyperledger Indy deployed locally via VON-Network.
2. **Identity Agents:** Uses Aries Cloud Agent Python (ACA-Py) for **Issuer** and **Verifier** roles.
3. **Governance Service (Tamper Prevention):** Custom Node.js service implementing **Threshold Signatures (k-of-n)** to prevent unilateral credential revocation by a single admin.
4. **Verification Gateway:** Node.js middleware handling credential verification, **Distributed Rate Limiting** (via Redis), and audit trail logging.
5. **Transparency Log:** Uses Sigstore Trillian & Rekor to provide **immutable** Merkle Tree-based audit logs.
6. **Databases:**
   - **PostgreSQL:** Wallet storage for ACA-Py.
   - **MySQL 8.0:** Merkle Tree storage backend for Trillian.
   - **Redis:** State management for Rate Limiting and Governance quorum.

---

## 🗺️ Architecture Mapping

| Conceptual Component         | Technology / Implementation | Location / Namespace                 | Port                      |
| ---------------------------- | --------------------------- | ------------------------------------ | ------------------------- |
| **VDR (Ledger)**       | Hyperledger Indy (VON)      | External (Docker Host)               | 9000 (Web), 9701–9708    |
| **Issuer Agent**       | ACA-Py (Government Issuer)  | `ssi-network/issuer-agent`         | 8000 (CDTP), 8001 (Admin) |
| **Verifier Agent**     | ACA-Py (Sidecar)            | `ssi-network/verification-gateway` | 8020 (CDTP), 8021 (Admin) |
| **Tamper Prevention**  | Governance Service          | `ssi-network/governance-service`   | 3000                      |
| **Verification Logic** | Verification Gateway        | `ssi-network/verification-gateway` | 4000                      |
| **Transparency Log**   | Rekor Server                | `ssi-network/rekor-server`         | 3000                      |
| **Log Backend**        | Trillian Log Server         | `ssi-network/trillian-log-server`  | 8090 (HTTP), 8091 (gRPC)  |
| **Immutable Storage**  | MySQL 8.0                   | `ssi-network/trillian-mysql`       | 3306                      |

---

## 🏗️ Setup Guide

### 1. Prerequisites

- **Docker Desktop** (with Kubernetes enabled)
- **kubectl** CLI
- **Git**
- **Python 3**

---

### 2. Setup Local Indy Ledger (VON-Network)

The system requires a running Indy network. We use `von-network` for local simulation.

```powershell
# Run outside this repository directory
git clone https://github.com/bcgov/von-network.git
cd von-network
./manage build
./manage start
```

Ensure the Web UI is accessible at: `http://localhost:9000`

---

### 3. Build & Deploy SSI Kit

#### Build Local Images

```powershell
# Governance Service
cd src/governance-service
docker build -t dn06/ssi:governance-service-v1 .

# Verification Gateway
cd ../verification-gateway
docker build -t dn06/ssi:gateway-middleware-v1 .
```

#### Making secreat key

```
cp k8s-secrets.template.yaml k8s-secrets.yaml
```

Edit the k8s-secrets.yaml

```
openssl rand -base64 32
```

Apply secrets:

```
kubectl apply -f k8s-secrets.yaml
```

#### Deploy to Kubernetes

```powershell
# Return to project root
kubectl apply -f k8s-deployment.yaml
```

---

### 4. Verify Status

Ensure all pods are `Running`:

```powershell
kubectl get pods -n ssi-network
```

---

## 🧪 Testing Scenarios (Step-by-Step)

### A. Threshold Revocation Mechanism (Admin)

Prevents unilateral credential revocation.

#### Step 1: Submit Proposal (Requires Admin JWT)

```bash
curl -X POST http://localhost:3000/proposals \
  -H "Authorization: Bearer <JWT_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "REVOKE_CREDENTIAL",
    "payload": { "cred_rev_id": "1", "rev_reg_id": "RR-123" }
  }'
```

Output:

```json
{"proposalId": "uuid-123...", "status": "PENDING"}
```

#### Step 2: Validator Voting (Threshold Security)

Repeat for 3 different validators:

```bash
curl -X POST http://localhost:3000/proposals/<PROPOSAL_ID>/approve \
  -H "Content-Type: application/json" \
  -d '{
    "validatorId": "validator_1",
    "signature": "<ED25519_SIGNATURE>"
  }'
```

**Result:** Once quorum is reached (e.g., 3 of 5), the Governance Service automatically calls the Issuer Agent to write to the ledger.

---

### B. Secure Verification & Audit Trail (Verifier)

#### Step 1: Send Verification Request

```bash
curl -X POST http://localhost:4000/verify \
  -H "Authorization: Bearer <JWT_VERIFIER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_request_data": {
      "name": "Check Degree",
      "version": "1.0",
      "requested_attributes": {
        "attr1_referent": { "name": "degree", "restrictions": [] }
      }
    }
  }'
```

#### Step 2: Check Audit Log in Rekor (Transparency Log)

```bash
# Access Rekor API directly
curl http://localhost:3000/api/v1/log/entries?logIndex=0
```

---

## 🛡️ Security & Privacy

- **RBAC & Network Policies:** Traffic isolation between pods.
- **Secret Management:** Wallet keys stored as Kubernetes Secrets.
- **Zero-Knowledge Proofs:** Holder privacy preserved via Hyperledger Aries standards.

---

*This project is a final thesis for undergraduate program in Technology Informatics, Sepuluh Nopember Institute of Technology, Surabaya.*
