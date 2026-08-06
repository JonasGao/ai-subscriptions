import crypto from "crypto";

function hmacSHA256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function formatDate(date: Date): string {
  // YYYYMMDD
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 8);
}

function formatXDate(date: Date): string {
  // YYYYMMDDTHHMMSSZ
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function signVolcengineRequest(opts: {
  method: string;
  url: string;
  body: string;
  ak: string;
  sk: string;
  region?: string;
  service?: string;
}): Record<string, string> {
  const { method, url, body, ak, sk } = opts;
  const region = opts.region ?? "cn-beijing";
  const service = opts.service ?? "ark";

  const parsed = new URL(url);
  const host = parsed.host;
  const canonicalUri = parsed.pathname || "/";
  const canonicalQueryString = parsed.search
    ? parsed.search
        .slice(1)
        .split("&")
        .sort()
        .map((p) => {
          const [k, v] = p.split("=");
          return `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`;
        })
        .join("&")
    : "";

  const now = new Date();
  const xDate = formatXDate(now);
  const dateStamp = formatDate(now);
  const credentialScope = `${dateStamp}/${region}/${service}/request`;

  // Headers to sign (must be lowercase, sorted)
  const headersToSign: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-date": xDate,
  };

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders =
    sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}`).join("\n") + "\n";
  const signedHeaders = sortedHeaderKeys.join(";");

  const hashedPayload = sha256Hex(body);

  // Step 1: Canonical Request
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // Step 2: String to Sign
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // Step 3: Signing Key
  const dateKey = hmacSHA256("HMAC" + sk, dateStamp);
  const regionKey = hmacSHA256(dateKey, region);
  const serviceKey = hmacSHA256(regionKey, service);
  const signingKey = hmacSHA256(serviceKey, "request");

  // Step 4: Signature
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization = `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "Content-Type": "application/json",
    Host: host,
    "X-Date": xDate,
    Authorization: authorization,
  };
}
