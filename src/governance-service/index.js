/**
 * Governance Service
 * * PRODUCTION GRADE IMPLEMENTATION
 * * Features: Redis, Ed25519 Crypto, JWT Admin.
 * * NEW: Helmet & Graceful Shutdown.
 */

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(helmet()); // Security Headers
app.use(express.json());

const THRESHOLD = 3; 
const ISSUER_ADMIN_URL = process.env.ISSUER_ADMIN_URL || 'http://localhost:8001';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET; 

if (!JWT_SECRET) {
    console.error("[CRITICAL] JWT_SECRET is missing.");
    process.exit(1);
}

const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('[Redis] Client Error', err));

const VALIDATORS = {};
const KEYS_DIR = process.env.VALIDATOR_KEYS_PATH;

if (KEYS_DIR && fs.existsSync(KEYS_DIR)) {
    const files = fs.readdirSync(KEYS_DIR);
    files.forEach(file => {
        if (file.endsWith('.pub')) {
            const name = path.basename(file, '.pub');
            VALIDATORS[name] = { publicKey: fs.readFileSync(path.join(KEYS_DIR, file), 'utf8') };
        }
    });
    console.log(`[Security] Loaded ${Object.keys(VALIDATORS).length} validators from ${KEYS_DIR}`);
} else {
    // Fallback for development if no volume is mounted
    VALIDATORS['validator_1'] = { publicKey: `-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA/WdbM+2xT5v3tE1qk6x7W2x3+7j7X9x8x3+7j7X9x8w=\n-----END PUBLIC KEY-----` };
    console.warn("[Security] Using fallback hardcoded validator keys.");
}

const requireAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
            if (payload.role === 'admin') {
                req.user = payload;
                return next();
            }
        } catch (err) { /* invalid */ }
    }
    return res.status(403).json({ error: 'Forbidden: Admins Only' });
};

// Create Proposal
app.post('/proposals', requireAdmin, async (req, res, next) => {
    try {
        const proposalId = crypto.randomUUID();
        await redisClient.set(`proposal:${proposalId}`, JSON.stringify({
            id: proposalId,
            action: req.body.action,
            payload: req.body.payload,
            requestor: req.user.username,
            approvals: [],
            status: 'PENDING',
            createdAt: new Date().toISOString()
        }), { EX: 86400 });
        res.status(201).json({ proposalId, status: 'PENDING' });
    } catch (e) { next(e); }
});

// Vote
app.post('/proposals/:id/approve', async (req, res, next) => {
    const { id } = req.params;
    const { validatorId, signature } = req.body;
    
    try {
        const raw = await redisClient.get(`proposal:${id}`);
        if (!raw) return res.status(404).json({ error: 'Not Found' });
        const proposal = JSON.parse(raw);

        if (proposal.status !== 'PENDING') return res.status(400).json({ error: 'Finalized' });
        if (proposal.approvals.includes(validatorId)) return res.status(409).json({ error: 'Voted' });

        // Crypto: Bind signature to the full proposal content to prevent tampering/reuse
        const message = `${id}:${proposal.action}:${JSON.stringify(proposal.payload)}`;
        const isVerified = crypto.verify(
            null, 
            Buffer.from(message), 
            crypto.createPublicKey(VALIDATORS[validatorId].publicKey), 
            Buffer.from(signature, 'base64')
        );
        if (!isVerified) {
            console.warn(`[Security] Invalid signature for proposal ${id} from validator ${validatorId}`);
            return res.status(401).json({ error: 'Bad Sig' });
        }

        proposal.approvals.push(validatorId);
        if (proposal.approvals.length >= THRESHOLD) {
            if (proposal.action === 'REVOKE_CREDENTIAL') {
                // INILAH PENGGANTI ACCUMULATOR SERVICE
                // Governance Service memerintahkan Issuer Agent (ACA-Py) 
                // untuk memperbarui Cryptographic Accumulator di Ledger.
                await axios.post(`${ISSUER_ADMIN_URL}/revocation/revoke`, { ...proposal.payload, publish: true });
            }
            proposal.status = 'EXECUTED';
        }
        
        await redisClient.set(`proposal:${id}`, JSON.stringify(proposal));
        res.json({ status: proposal.status });
    } catch (e) { next(e); }
});

// Health Check (Moved UP before Error Handler)
app.get('/health', (req, res) => { 
    res.status(200).send('OK'); 
});

// Centralized Error Handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Error' });
});

// --- SHUTDOWN LOGIC & SINGLE LISTEN ---
const PORT = 3000;
const server = app.listen(PORT, async () => {
    await redisClient.connect();
    console.log(`Governance Service running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        redisClient.quit().then(() => process.exit(0));
    });
});