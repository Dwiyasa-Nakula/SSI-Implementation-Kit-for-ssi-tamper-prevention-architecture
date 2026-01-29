/**
 * Hanya jika tidak menggunakan server Rekor asli ().
 * Untuk lingkungan pengujian terbatas, menggunakan "Facade Pattern" atau "Stubbing" yang Kontrak API-nya (Input/Output) 100% sama
 * dengan yang asli (Rekor API) dengan komponen Transparency Log diimplementasikan menggunakan simulasi Append-Only berbasis Redis 
 * yang meniru spesifikasi API Rekor/Trillian.
 * 
 * Transparency Log Service (Mock Trillian/Rekor).
 * * Bertugas menerima "bukti" verifikasi dari Gateway dan menyimpannya secara urut (append-only) di Redis.
 * * Ini menggantikan server Rekor asli yang terlalu berat untuk laptop/Kind.
 */

const express = require("express");
const { createClient } = require("redis");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Konfigurasi Koneksi Redis
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redisClient = createClient({ url: REDIS_URL });

redisClient.on("error", (err) =>
  console.error("[Transparency Log] Redis Client Error", err),
);

// Inisialisasi Koneksi
(async () => {
  try {
    await redisClient.connect();
    console.log("[Transparency Log] Connected to Shared State (Redis)");
  } catch (e) {
    console.error("[Transparency Log] Failed to connect to Redis", e);
  }
})();

/**
 * Endpoint: Submit Log Entry
 * Meniru path API Rekor: POST /api/v1/log/entries
 */
app.post("/api/v1/log/entries", async (req, res) => {
  try {
    const payload = req.body;

    // 1. Validasi Payload Sederhana
    if (!payload || !payload.spec) {
      return res.status(400).json({ error: "Invalid payload structure" });
    }

    console.log("[Transparency Log] Menerima entri audit baru...");

    // 2. Buat Struktur Log (Append Only)
    const logId = crypto.randomUUID();
    const logEntry = {
      uuid: logId,
      timestamp: new Date().toISOString(),
      body: payload, // Data Hash yang dikirim Gateway
    };

    // 3. Simpan ke Redis List (Sifatnya Append-Only seperti Blockchain)
    // Key: 'audit:transparency_log'
    const listLength = await redisClient.rPush(
      "audit:transparency_log",
      JSON.stringify(logEntry),
    );

    console.log(`[Transparency Log] Entri tersimpan. Index: ${listLength}`);

    // 4. Response Sukses (Mirip Rekor)
    res.status(201).json({
      uuid: logId,
      logIndex: listLength,
      nodepix: "mock-proof",
    });
  } catch (error) {
    console.error("[Transparency Log] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Health Check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Transparency Log Server running on port ${PORT}`);
});
