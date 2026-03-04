import { Router } from "express";
import crypto from "node:crypto";
import { getPool } from "../database/pool.js";

const router = Router();

// POST /api/auth/register-keypair
// Called by Clerk webhook on user creation
router.post("/register-keypair", async (req, res) => {
  try {
    const { clerkId, displayName } = req.body;
    if (!clerkId || !displayName) {
      res.status(400).json({ error: "clerkId and displayName required" });
      return;
    }

    // Generate Ed25519 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Encrypt private key with master key
    const masterKey = process.env.MASTER_ENCRYPTION_KEY!;
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(masterKey, "salt", 32);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const privateKeyEncrypted = iv.toString("hex") + ":" + encrypted;

    const pool = getPool();
    await pool.query(
      `INSERT INTO users (clerk_id, display_name, public_key, private_key_encrypted)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clerk_id) DO NOTHING`,
      [clerkId, displayName, publicKey, privateKeyEncrypted],
    );

    res.json({ publicKey });
  } catch (err) {
    console.error("register-keypair error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
