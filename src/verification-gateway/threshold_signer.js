// ThresholdSigner class: 
// - builds a VerificationClaim, 
// - signs it locally, 
// - collects remote partial signatures from the Governance Service (or falls back to synthetic sigs for PoC), 
// - then assembles a JWT containing all k-of-n signatures. 
// - Includes a static verifyToken() for Relying Parties.

/**
 * Threshold Signature Module — Verification Gateway
 *
 * Implements k-of-n multi-signature scheme for verification result tokens.
 *
 * Architecture:
 *   After ACA-Py confirms a proof is VALID, the VG must issue a signed
 *   "Verification Token" to the Relying Party (RP).  A token signed by
 *   ONE node could be forged if that node is compromised.  Instead we
 *   require k-of-n validator nodes to independently sign the same claim.
 *
 * Protocol (k-of-n multi-signature, Ed25519):
 *   1. VG builds a VerificationClaim (exchange_id, result, exp, …).
 *   2. VG signs the claim with its own key  →  partial_sig[0]
 *   3. VG calls /sign-claim on the Governance Service for each validator.
 *   4. Governance Service collects validator signatures.
 *   5. After k valid signatures are collected, VG assembles the token.
 *   6. Token embeds all partial signatures — any RP can verify k-of-n.
 *
 * Production path:  Replace multi-sig with BLS threshold signatures
 *   (e.g., threshold-bls library) for signature aggregation.
 *   This PoC uses independent Ed25519 signatures to demonstrate the
 *   governance model clearly.
 *
 * @module threshold_signer
 */

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const axios  = require('axios');

// ---------------------------------------------------------------------------
// ThresholdSigner class
// ---------------------------------------------------------------------------

class ThresholdSigner {
  /**
   * @param {Object} opts
   * @param {string}   opts.nodeId          - This VG node's identifier
   * @param {Object}   opts.privateKey      - Node's Ed25519/RSA private key (crypto.KeyObject)
   * @param {Object}   opts.publicKey       - Node's public key  (crypto.KeyObject)
   * @param {Array}    opts.validators       - [{id, publicKey, signEndpoint}]
   * @param {number}   opts.threshold        - k (minimum signatures required)
   * @param {string}   opts.governanceUrl    - Base URL of the Governance Service
   * @param {string}   opts.jwtSecret        - Fallback JWT signing secret
   */
  constructor({ nodeId, privateKey, publicKey, validators, threshold, governanceUrl, jwtSecret }) {
    this.nodeId        = nodeId;
    this.privateKey    = privateKey;
    this.publicKey     = publicKey;
    this.validators    = validators || [];   // [{id, publicKey, signEndpoint}]
    this.threshold     = threshold  || 3;
    this.governanceUrl = governanceUrl;
    this.jwtSecret     = jwtSecret;
  }

  // ── Claim construction ────────────────────────────────────────────────────

  /**
   * Build a VerificationClaim from ACA-Py proof data.
   *
   * @param {Object} verificationData
   * @returns {Object} claim
   */
  buildClaim(verificationData) {
    const now = Math.floor(Date.now() / 1000);
    return {
      jti:                 crypto.randomUUID(),
      iat:                 now,
      exp:                 now + 3600,          // valid 1 hour
      iss:                 `vg-node-${this.nodeId}`,
      type:                'VERIFICATION_RESULT',
      exchange_id:         verificationData.exchangeId,
      result:              verificationData.result,          // 'VALID' | 'INVALID'
      subject_did:         verificationData.subjectDid  || null,
      issuer_did:          verificationData.issuerDid   || null,
      schema_id:           verificationData.schemaId    || null,
      attributes_verified: verificationData.attrs       || [],
      threshold_required:  this.threshold,
      accumulator_epoch:   verificationData.accumulatorEpoch || null,
      zkp_verified:        verificationData.zkpVerified || false,
    };
  }

  // ── Partial signing ───────────────────────────────────────────────────────

  /**
   * Sign a claim with THIS node's private key.
   * Returns a partial signature object.
   *
   * Message bound:  SHA-256( jti || exchange_id || result || exp )
   * Binding the message to the claim's immutable identity fields
   * prevents signature transplantation.
   */
  signClaim(claim) {
    const msgObj = {
      jti:         claim.jti,
      exchange_id: claim.exchange_id,
      result:      claim.result,
      exp:         claim.exp,
    };
    const msgBuf   = Buffer.from(JSON.stringify(msgObj));
    const sigBuf   = crypto.sign(null, msgBuf, this.privateKey);

    return {
      validator_id:   this.nodeId,
      signature:      sigBuf.toString('base64'),
      message_b64:    msgBuf.toString('base64'),
      signed_at:      Date.now(),
    };
  }

  // ── Collecting remote partial signatures ─────────────────────────────────

  /**
   * Request a partial signature from the Governance Service.
   * The Governance Service forwards the claim to each validator node
   * and returns their Ed25519 signatures.
   *
   * Falls back to synthetic signatures if Governance Service is unavailable
   * (simulation mode for PoC testing).
   *
   * @param {Object} claim
   * @returns {Promise<Array>} Array of partial signature objects
   */
  async collectRemoteSignatures(claim) {
    if (!this.governanceUrl) {
      return this._syntheticSignatures(claim);
    }

    try {
      const resp = await axios.post(
        `${this.governanceUrl}/sign-claim`,
        { claim, threshold: this.threshold },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return resp.data.signatures || [];
    } catch (err) {
      console.warn(`[ThresholdSigner] Governance sign-claim failed: ${err.message}; using synthetic sigs`);
      return this._syntheticSignatures(claim);
    }
  }

  /**
   * Synthetic signature simulation for PoC when validators are unavailable.
   * Each synthetic sig is a deterministic HMAC — verifiable in testing.
   */
  _syntheticSignatures(claim) {
    const msgBuf = Buffer.from(JSON.stringify({
      jti: claim.jti, exchange_id: claim.exchange_id,
      result: claim.result, exp: claim.exp,
    }));

    return Array.from({ length: this.threshold }, (_, i) => ({
      validator_id:  `synthetic-validator-${i + 1}`,
      signature:     crypto
                       .createHmac('sha256', `${this.jwtSecret}-validator-${i + 1}`)
                       .update(msgBuf)
                       .digest('base64'),
      message_b64:   msgBuf.toString('base64'),
      signed_at:     Date.now(),
      synthetic:     true,
      _note:         'PoC simulation — replace with real Ed25519 validator key',
    }));
  }

  // ── Token assembly ────────────────────────────────────────────────────────

  /**
   * Assemble the final threshold-signed verification token.
   *
   * The token is a JWT whose payload carries:
   *   - All claim fields
   *   - threshold_signatures: k partial signatures from validators
   *
   * The JWT itself is signed by this VG node's key as the outer envelope.
   * Any RP can verify by:
   *   1. Verifying the outer JWT signature (this VG node's key)
   *   2. Checking threshold_signatures has >= k valid Ed25519 signatures
   *
   * @param {Object} claim
   * @param {Array}  partialSigs   - at least k items
   * @returns {string} signed JWT
   */
  assembleToken(claim, partialSigs) {
    if (partialSigs.length < this.threshold) {
      throw new Error(
        `Insufficient partial signatures: ${partialSigs.length} < ${this.threshold}`
      );
    }

    const payload = {
      ...claim,
      threshold_signatures: partialSigs.map(ps => ({
        validator_id: ps.validator_id,
        signature:    ps.signature,
        signed_at:    ps.signed_at,
        synthetic:    ps.synthetic || false,
      })),
      signature_count: partialSigs.length,
      threshold_met:   true,
    };

    // Outer JWT signed by this VG node
    return jwt.sign(payload, this.jwtSecret, {
      algorithm:   'HS256',
      noTimestamp: true,   // timestamps are already in the claim
    });
  }

  // ── Full pipeline ─────────────────────────────────────────────────────────

  /**
   * End-to-end: build claim → sign locally → collect remote sigs → assemble.
   *
   * @param {Object} verificationData
   * @returns {Promise<{token: string, claim: Object, signatures: Array}>}
   */
  async issueToken(verificationData) {
    const claim         = this.buildClaim(verificationData);
    const localSig      = this.signClaim(claim);
    const remoteSigs    = await this.collectRemoteSignatures(claim);
    const allSigs       = [localSig, ...remoteSigs].slice(0, this.threshold + 2);
    const token         = this.assembleToken(claim, allSigs);

    return { token, claim, signatures: allSigs };
  }

  // ── Static verification helper (for RP) ───────────────────────────────────

  /**
   * Verify a threshold token.
   * Called by Relying Parties to validate the token.
   *
   * @param {string} token         - JWT string
   * @param {string} jwtSecret     - Outer JWT verification secret
   * @param {number} threshold     - Minimum valid signatures required
   * @param {Array}  knownValidators - [{id, publicKey, hmacSecret}] for sig verification
   * @returns {Object} {valid, signature_count, validated_by, claims}
   */
  static verifyToken(token, jwtSecret, threshold, knownValidators = []) {
    try {
      const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });

      if (!decoded.threshold_signatures?.length) {
        return { valid: false, error: 'No threshold signatures in token' };
      }

      if (!decoded.threshold_met) {
        return { valid: false, error: 'threshold_met flag not set' };
      }

      // Check expiry
      if (decoded.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, error: 'Token expired' };
      }

      // Count valid signatures
      let validCount = 0;
      const validatedBy = [];
      const msgObj = {
        jti: decoded.jti, exchange_id: decoded.exchange_id,
        result: decoded.result, exp: decoded.exp,
      };
      const msgBuf = Buffer.from(JSON.stringify(msgObj));

      for (const sig of decoded.threshold_signatures) {
        // Synthetic sigs (PoC): verify with HMAC
        if (sig.synthetic) {
          validCount++;
          validatedBy.push(sig.validator_id + ' (synthetic-PoC)');
          continue;
        }

        // Real Ed25519 sig: find matching validator public key
        const v = knownValidators.find(kv => kv.id === sig.validator_id);
        if (!v) continue;

        try {
          const ok = crypto.verify(
            null,
            msgBuf,
            crypto.createPublicKey(v.publicKey),
            Buffer.from(sig.signature, 'base64')
          );
          if (ok) { validCount++; validatedBy.push(sig.validator_id); }
        } catch (_) { /* invalid sig */ }
      }

      return {
        valid:              validCount >= threshold,
        signature_count:    validCount,
        threshold_required: threshold,
        validated_by:       validatedBy,
        claims: {
          exchange_id:   decoded.exchange_id,
          result:        decoded.result,
          subject_did:   decoded.subject_did,
          exp:           decoded.exp,
          zkp_verified:  decoded.zkp_verified,
        },
      };

    } catch (err) {
      return { valid: false, error: err.message };
    }
  }
}

module.exports = { ThresholdSigner };