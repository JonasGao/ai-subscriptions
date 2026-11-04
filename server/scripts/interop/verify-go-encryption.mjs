#!/usr/bin/env node
// Decrypts Go-produced ciphertext with lib/encryption.ts's algorithm and
// prints the result as JSON. Invoked by the Go crypto test to prove the
// "Go encrypts, Node decrypts" direction without a JS test runner.
//   node verify-go-encryption.mjs <secret> <apiKeyCipher> <credentialsCipher>
import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function getEncryptionKey(secret) {
  return crypto
    .createHash("sha256")
    .update(secret + "-api-key-encryption")
    .digest();
}

function decrypt(secret, encrypted) {
  const parts = encrypted.split(":");
  if (parts.length !== 2 || parts[0].length !== IV_LENGTH * 2) {
    throw new Error(`unexpected api-key ciphertext shape: ${encrypted}`);
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(secret),
    Buffer.from(parts[0], "hex"),
  );
  return decipher.update(parts[1], "hex", "utf8") + decipher.final("utf8");
}

function decryptCredentials(secret, encrypted) {
  if (!encrypted.startsWith("v1:")) {
    throw new Error(`unexpected credentials ciphertext prefix: ${encrypted}`);
  }
  const rest = encrypted.slice(3);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) {
    throw new Error("credentials ciphertext is missing its IV separator");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(secret),
    Buffer.from(rest.slice(0, colonIdx), "hex"),
  );
  const json =
    decipher.update(rest.slice(colonIdx + 1), "hex", "utf8") +
    decipher.final("utf8");
  return JSON.parse(json);
}

const [secret, apiKeyCipher, credsCipher] = process.argv.slice(2);
const result = {
  apiKey: decrypt(secret, apiKeyCipher),
  credentials: decryptCredentials(secret, credsCipher),
};
process.stdout.write(JSON.stringify(result) + "\n");
