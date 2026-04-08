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

1. **VDR (Verifiable Data Registry):** Uses **Hyperledger Indy** (4-node) running natively as a cluster inside Kubernetes.
2. **Identity Agents:** Uses **Aries Cloud Agent Python (ACA-Py)** for **Issuer**, **Holder**, and **Verifier** roles.
3. **Accumulator Service**: Service managing revocation status using a cryptographic RSA Accumulator structure with zero-knowledge non-membership proofs (ZKP) and *Fraud Detection* monitoring.
4. **Governance Service (Tamper Prevention):** Custom Node.js service implementing **Threshold Signatures (k-of-n)** for multi-admins. Prevents unilateral credential revocation by a single entity.
5. **Verification Gateway:** Node.js middleware handling credential verification, **Distributed Rate Limiting** protection (via Redis), and audit trail logging.
6. **Transparency Log:** Uses **Sigstore Trillian** & **Rekor** to provide **immutable** Merkle Tree-based verification audit logs.
7. **Databases:**
   - **PostgreSQL:** Secure wallet storage for ACA-Py.
   - **MySQL 8.0:** Merkle Tree data storage for Sigstore Trillian.
   - **Redis:** State management for Rate Limiting, Accumulator cache, and Governance quorum.

---

## 🗺️ Architecture Mapping

| Conceptual Component         | Technology / Implementation | Location / Namespace                 | Port                      |
| ---------------------------- | --------------------------- | ------------------------------------ | ------------------------- |
| **VDR (Ledger)**             | Hyperledger Indy (4-Node)   | `ssi-network` (von-webserver)        | 8000 (Web), 9701-9708     |
| **ZKP Accumulator**          | Fast API Accumulator        | `ssi-network/accumulator-service`    | 8080                      |
| **Issuer Agent**             | ACA-Py (Government Issuer)  | `ssi-network/issuer-agent`           | 8000 (CDTP), 8001 (Admin) |
| **Verifier Agent**           | ACA-Py (Sidecar)            | `ssi-network/verification-gateway`   | 8020 (CDTP), 8021 (Admin) |
| **Tamper Prevention**        | Governance Service          | `ssi-network/governance-service`     | 3000                      |
| **Verification Logic**       | Verification Gateway        | `ssi-network/verification-gateway`   | 4000                      |
| **Transparency Log**         | Rekor Server                | `ssi-network/rekor-server`           | 3000                      |
| **Log Backend**              | Trillian Log Server         | `ssi-network/trillian-log-server`    | 8090 (HTTP), 8091 (gRPC)  |
| **Immutable Storage**        | MySQL 8.0                   | `ssi-network/trillian-mysql`         | 3306                      |

---

## 🏗️ Setup Guide

### 1. Prerequisites

- **Docker Desktop** (with Kubernetes enabled)
- **kubectl** CLI
- **Git**
- **Python 3**

---

### 2. Build & Deploy SSI Kit

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

### A. End-to-End Workflow Testing (Automated)

To test the entire SSI workflow from issuance to verification autonomously, use the provided End-to-End (E2E) test script. This script orchestrates an ephemeral Holder wallet and connects with the Issuer and Verification Gateway.

#### Step 1: Port-Forward Services
Open three separate terminals and run the following commands to expose the required Kubernetes services locally:

```bash
kubectl port-forward svc/issuer-agent 8001:8001 -n ssi-network
kubectl port-forward svc/verification-gateway 4000:4000 -n ssi-network
kubectl port-forward svc/holder-agent 8031:8031 -n ssi-network
```

#### Step 2: Run the E2E Script
Ensure you have the required Python dependencies installed (`requests`, `colorama`). Then, run the script from the root directory:

```bash
# Install dependencies if you haven't already
pip install requests colorama

# Run the test
python src/test_e2e.py
```

**Result:** The script will automatically:
1. Register the Issuer DID and create schemas/credential definitions.
2. Establish a connection between the Issuer and the Holder wallet.
3. Issue a verifiable credential to the Holder.
4. Simulate the Relaying Party requesting verification via the Gateway.
5. The Holder creates and presents a proof.
6. The Gateway verifies the proof and logs the transaction to Rekor.

---

### B. Threshold Revocation Mechanism (Admin)

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

### C. Secure Verification & Audit Trail (Verifier)

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

*This project is a final thesis for undergraduate program in Information Technology, Sepuluh Nopember Institute of Technology, Surabaya.*
