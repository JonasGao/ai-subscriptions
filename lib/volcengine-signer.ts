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

  const hashedPayload = sha256Hex(body);

  // Headers to sign — mirrors official SDK (@volcengine/openapi Signer):
  // content-type is in the unsignable list, kDatePrefix is "", and
  // signed headers are sorted alphabetically.
  const headersToSign: Array<[string, string]> = (
    [
      ["host", host],
      ["x-content-sha256", hashedPayload],
      ["x-date", xDate],
    ] as Array<[string, string]>
  ).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const canonicalHeaders =
    headersToSign.map(([k, v]) => `${k}:${v}`).join("\n") + "\n";
  const signedHeaders = headersToSign.map(([k]) => k).join(";");

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

  // Step 3: Signing Key — official SDK uses empty kDatePrefix
  const dateKey = hmacSHA256(sk, dateStamp);
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
    "X-Content-Sha256": hashedPayload,
    "X-Date": xDate,
    Authorization: authorization,
  };
}
