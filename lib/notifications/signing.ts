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
