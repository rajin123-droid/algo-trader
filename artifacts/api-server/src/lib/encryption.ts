import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { authConfig } from "../config/auth.js";

const ALGORITHM = "aes-256-gcm";

/**
 * Derive a stable 32-byte AES key from SESSION_SECRET (via authConfig).
 * SHA-256 gives us exactly 32 bytes and is deterministic — the same
 * secret always produces the same key, so data encrypted in one process
 * can be decrypted in another.
 */
function getKey(): Buffer {
  return createHash("sha256").update(authConfig.sessionSecret).digest();
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output format (all hex, colon-delimited): iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const key = getKey();

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypt a value produced by `encrypt()`.
 */
export function decrypt(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Returns true if the stored value looks like an encrypted token
 * (iv:authTag:ciphertext hex triple). Used for backward-compat when
 * migrating plaintext rows that existed before encryption was added.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 3 &&
    parts.every((p) => /^[0-9a-f]+$/i.test(p))
  );
}

/**
 * Safely decrypt a value that may or may not already be encrypted.
 * If it is not encrypted (legacy plaintext row), return it as-is.
 */
export function safeDecrypt(value: string): string {
  return isEncrypted(value) ? decrypt(value) : value;
}
