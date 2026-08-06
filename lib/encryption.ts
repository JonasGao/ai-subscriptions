import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret =
    process.env.NEXTAUTH_SECRET ||
    "ai-subscriptions-secret-key-change-in-production";
  return crypto
    .createHash("sha256")
    .update(secret + "-api-key-encryption")
    .digest();
}

export function encryptApiKey(text: string): string {
  if (!text || text.includes(":")) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = cipher.update(text, "utf8", "hex") + cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptApiKey(encrypted: string): string {
  if (!encrypted || !encrypted.includes(":")) return encrypted;
  const parts = encrypted.split(":");
  if (parts.length !== 2 || parts[0].length !== IV_LENGTH * 2) return encrypted;
  const iv = Buffer.from(parts[0], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  return decipher.update(parts[1], "hex", "utf8") + decipher.final("utf8");
}

export function encryptCredentials(creds: Record<string, string>): string {
  const json = JSON.stringify(creds);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = cipher.update(json, "utf8", "hex") + cipher.final("hex");
  return "v1:" + iv.toString("hex") + ":" + encrypted;
}

export function decryptCredentials(encrypted: string): Record<string, string> {
  if (!encrypted || !encrypted.startsWith("v1:")) return {};
  try {
    const rest = encrypted.slice(3);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return {};
    const iv = Buffer.from(rest.slice(0, colonIdx), "hex");
    const ciphertext = rest.slice(colonIdx + 1);
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    const json =
      decipher.update(ciphertext, "hex", "utf8") + decipher.final("utf8");
    const parsed = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}
