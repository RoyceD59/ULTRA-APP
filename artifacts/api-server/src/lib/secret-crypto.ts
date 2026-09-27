/**
 * AES-256-GCM symmetric encryption for sensitive settings stored in the DB.
 *
 * The key is derived from SESSION_SECRET via SHA-256 so it is always 32 bytes.
 * Encrypted values are stored as `<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 *
 * Rotation: re-encrypt with the current key and store. Old env-var secrets remain
 * readable from the env and need not be re-encrypted on upgrade.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set — cannot encrypt/decrypt settings. " +
        "Set SESSION_SECRET in your environment."
    );
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string. Returns a compact hex-encoded blob safe for DB storage.
 * Throws if SESSION_SECRET is absent.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), ct.toString("hex")].join(":");
}

/**
 * Decrypt a blob produced by encryptSecret. Returns null on any decryption failure
 * (bad key, tampered ciphertext, wrong format) rather than throwing, so callers can
 * fall back to the env-var value gracefully.
 */
export function decryptSecret(blob: string): string | null {
  try {
    const key = getKey();
    const parts = blob.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, ctHex] = parts as [string, string, string];
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctHex, "hex")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}
