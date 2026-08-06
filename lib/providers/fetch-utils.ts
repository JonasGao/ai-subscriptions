export const DEFAULT_TIMEOUT = 10000;

const SENSITIVE_HEADER_KEYS = ["authorization", "api-key", "x-api-key"];
const SENSITIVE_BODY_KEYS = [
  "ak",
  "sk",
  "apikey",
  "key",
  "secret",
  "token",
  "password",
  "auth",
];

function maskHeaderValue(headerKey: string, value: string): string {
  if (SENSITIVE_HEADER_KEYS.includes(headerKey.toLowerCase())) {
    return value.slice(0, 10) + "...";
  }
  return value;
}

function maskHeaders(headers: HeadersInit | undefined): string {
  if (!headers) return "{}";
  const obj: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      obj[key] = maskHeaderValue(key, value);
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      obj[key] = maskHeaderValue(key, String(value));
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      obj[key] = maskHeaderValue(key, String(value));
    }
  }
  return JSON.stringify(obj);
}

function maskBodyValue(key: string, value: unknown): unknown {
  if (SENSITIVE_BODY_KEYS.includes(key.toLowerCase())) {
    return "***";
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return maskBodyObject(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "object" && item !== null) {
        return maskBodyObject(item as Record<string, unknown>);
      }
      return item;
    });
  }
  return value;
}

function maskBodyObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = maskBodyValue(key, value);
  }
  return result;
}

function maskBody(body: BodyInit | null | undefined): string {
  if (!body) return "";
  let str: string;
  if (typeof body === "string") {
    str = body;
  } else {
    str = String(body);
  }
  if (!str.trim()) return "";
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(maskBodyObject(parsed));
    }
    return str;
  } catch {
    return str;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();

  // Request log
  console.log(
    `[fetch] ${method} ${url} headers=${maskHeaders(options.headers)} body=${maskBody(options.body)}`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });

    // Response log — clone so the caller can still read the body
    let responseHeaders: Record<string, string> = {};
    let responseBodyText = "";
    try {
      if (response.headers && typeof response.headers.forEach === "function") {
        response.headers.forEach((value: string, key: string) => {
          responseHeaders[key] = value;
        });
      }
      if (typeof response.clone === "function") {
        const cloned = response.clone();
        responseBodyText = await cloned.text();
      }
    } catch {
      responseBodyText = responseBodyText || "<unreadable>";
    }
    console.log(
      `[fetch] ${response.status} ${url} headers=${JSON.stringify(responseHeaders)} body=${responseBodyText}`
    );

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
