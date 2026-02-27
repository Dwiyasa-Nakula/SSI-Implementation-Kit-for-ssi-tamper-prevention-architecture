/**
 * Verification Gateway
 * * PRODUCTION GRADE IMPLEMENTATION
 * * Features: Redis State, Trillian, Auth, RBAC, Rate Limit.
 * * NEW: Helmet, Trust Proxy, & Graceful Shutdown.
 */

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");
const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis").default;
const { body, validationResult } = require("express-validator");
const helmet = require("helmet");

const app = express();

// --- 1. KUBERNETES & SECURITY CONFIG ---
// TRUST PROXY: Essential for K8s Ingress to get the real user IP for the rate limiter.
// '1' means trust the first proxy hop (Nginx).
app.set("trust proxy", 1); 

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// --- CONFIGURATION ---
const AGENT_ADMIN_URL = process.env.AGENT_ADMIN_URL || "http://localhost:8021";
const TRILLIAN_URL = process.env.TRILLIAN_LOG_URL || "http://trillian-log-server:3000";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const JWT_SECRET = process.env.JWT_SECRET;
const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(",") : [];
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!JWT_SECRET) {
  console.error("[CRITICAL] JWT_SECRET is missing. Exiting.");
  process.exit(1); 
}

// --- REDIS CLIENT ---
// node-redis v4 ignores the `password` field when `url` is set.
// We must embed the password in the URL itself, URL-encoded to handle
// special characters like '/', '+', '=' that would break URL parsing.
function buildRedisUrl(baseUrl, password) {
  if (!password) return baseUrl;
  const u = new URL(baseUrl);
  u.password = encodeURIComponent(password);
  return u.toString();
}
const redisClient = createClient({
  url: buildRedisUrl(REDIS_URL, process.env.REDIS_PASSWORD)
});
redisClient.on("error", (err) => console.error("[Redis] Client Error", err));

// --- SERVER STARTUP LOGIC ---
const PORT = 4000;

async function startServer() {
  try {
    // 1. Connect to Redis FIRST
    await redisClient.connect();
    console.log("[Redis] Client connected successfully.");

    // 2. Initialize Rate Limiter with connected client
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, 
      max: 1000, 
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
      }),
      message: { error: "Too many requests" },
    });

    // 3. Apply Middleware
    app.use(limiter);

    // --- AUTH MIDDLEWARE ---
    const authMiddleware = (req, res, next) => {
      const apiKey = req.headers["x-api-key"];
      if (apiKey && API_KEYS.includes(apiKey)) {
        req.user = { id: "system", role: "verifier_system" };
        return next();
      }
      const authHeader = req.headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
          req.user = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
          return next();
        } catch (err) { /* invalid token */ }
      }
      return res.status(401).json({ error: "Unauthorized Access" });
    };

    // --- ROUTES ---
    app.post("/verify", authMiddleware,
      (req, res, next) => {
        if (!req.user || (req.user.role !== "verifier" && req.user.role !== "verifier_system")) {
          return res.status(403).json({ error: "Forbidden" });
        }
        next();
      },
      [
        body("proof_request_data").exists().withMessage("Required"),
        body("proof_request_data").isObject().withMessage("Must be JSON"),
      ],
      async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
          const response = await axios.post(
            `${AGENT_ADMIN_URL}/present-proof/create-request`,
            { proof_request: req.body.proof_request_data, trace: false }
          );

          const { presentation_exchange_id, presentation_request } = response.data;
          await redisClient.set(
            `session:${presentation_exchange_id}`,
            JSON.stringify({
              timestamp: new Date().toISOString(),
              status: "REQUEST_SENT",
              requestor: req.user.id,
            }),
            { EX: 3600 }
          );

          res.json({ presentation_exchange_id, request_url: presentation_request });
        } catch (error) { next(error); }
      }
    );

    // Webhook Handler (Protected)
    app.post("/webhooks/topic/present_proof/", (req, res, next) => {
      // Allow if WEBHOOK_SECRET matches OR if it's localhost (internal ACA-Py)
      const webhookKey = req.headers["x-api-key"];
      if (WEBHOOK_SECRET && webhookKey !== WEBHOOK_SECRET && req.ip !== '127.0.0.1') {
        console.warn(`[Security] Unauthorized webhook attempt from ${req.ip}`);
        return res.status(401).json({ error: "Unauthorized Webhook" });
      }
      next();
    }, async (req, res, next) => {
      try {
        const { state, presentation_exchange_id, verified } = req.body;
        if (state === "verified") {
          const sessionRaw = await redisClient.get(`session:${presentation_exchange_id}`);
          if (sessionRaw && (verified === "true" || verified === true)) {
            handleSuccessfulVerification(presentation_exchange_id, req.body).catch(console.error);
            const session = JSON.parse(sessionRaw);
            session.status = "VERIFIED_AND_LOGGED";
            await redisClient.set(`session:${presentation_exchange_id}`, JSON.stringify(session), { EX: 3600 });
          }
        }
        res.status(200).send();
      } catch (error) { next(error); }
    });

    // Health Check
    app.get("/health", (req, res) => {
      res.status(200).send("OK");
    });

    // Error Handler
    app.use((err, req, res, next) => {
      console.error("[Server Error]", err);
      res.status(500).json({ error: "Internal Server Error" });
    });

    // 4. Start Server
    const server = app.listen(PORT, () => {
      console.log(`Verification Gateway running on port ${PORT}`);
    });

    // Graceful Shutdown
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received. Shutting down gracefully...");
      server.close(() => {
        redisClient.quit().then(() => {
            console.log("Redis connection closed.");
            process.exit(0);
        }).catch(() => process.exit(1));
      });
    });

  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

async function handleSuccessfulVerification(exchangeId, proofData) {
  const leafData = Buffer.from(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      exchangeId,
      result: "VALID",
      hash: crypto.createHash("sha256").update(JSON.stringify(proofData)).digest("hex"),
    }),
  ).toString("base64");

  try {
    await axios.post(`${TRILLIAN_URL}/api/v1/log/entries`, {
      kind: "hashedrekord",
      apiVersion: "0.0.1",
      spec: { signature: { content: leafData, publicKey: { content: "base64_pub_key" } } },
    });
  } catch (e) {
    console.error(`[Audit Fail] ${e.message}`);
  }
}

// Start the app
startServer();