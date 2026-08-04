import crypto from "crypto";

/**
 * DingTalk HMAC-SHA256 signing.
 *
 * Computes `HMAC-SHA256(secret, timestamp + "\n" + secret)` and returns
 * URL-safe base64. The caller prepends `&timestamp=...&sign=...` to the URL.
 *
 * Returns null when secret is empty (no-sign mode).
 */
export function computeDingtalkSign(
  secret: string | undefined,
  timestampMs: number
): { timestamp: number; sign: string } | null {
  if (!secret) return null;
  const stringToSign = `${timestampMs}\n${secret}`;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");
  const sign = encodeURIComponent(hmac);
  return { timestamp: timestampMs, sign };
}

/**
 * Feishu (Lark) custom bot HMAC-SHA256 signing.
 *
 * Per the official Feishu docs the signing key is `timestamp + "\n" + secret`
 * and the signed data is the empty string — this is the *opposite* orientation
 * of DingTalk (which uses `secret` as the key and `timestamp + "\n" + secret`
 * as the data). The result is plain base64 (not URL-encoded) because it is
 * placed inside the JSON message body, not a URL query param.
 *
 * `timestampSec` is the unix timestamp in **seconds** (Feishu convention) and
 * is returned as a string so callers can embed it directly into the body.
 *
 * Returns null when secret is empty (no-sign / keyword mode).
 */
export function computeFeishuSign(
  secret: string | undefined,
  timestampSec: number
): { timestamp: string; sign: string } | null {
  if (!secret) return null;
  const timestamp = String(timestampSec);
  const key = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac("sha256", key).update("").digest("base64");
  return { timestamp, sign };
}
