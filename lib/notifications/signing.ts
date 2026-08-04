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
 * Feishu (Lark) v2 webhook has no HMAC signing mechanism in the same sense;
 * the "sign" step here is a placeholder that returns the timestamp for
 * completeness. We expose it as a pure function for testability, but Feishu
 * payload signing is effectively a no-op at this layer.
 *
 * Returns null when secret is empty.
 */
export function computeFeishuSign(
  secret: string | undefined,
  timestampSec: number
): { timestamp: number; sign: string } | null {
  if (!secret) return null;
  const stringToSign = `${timestampSec}\n${secret}`;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");
  return { timestamp: timestampSec, sign: hmac };
}
