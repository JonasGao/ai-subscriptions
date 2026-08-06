import { describe, it, expect, vi, beforeEach } from "vitest";
import { signVolcengineRequest } from "@/lib/volcengine-signer";

describe("signVolcengineRequest", () => {
  beforeEach(() => {
    // Fix the date for deterministic testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T08:00:00.000Z"));
  });

  it("returns required headers", () => {
    const headers = signVolcengineRequest({
      method: "POST",
      url: "https://open.volcengineapi.com/open/GetAFPUsage",
      body: "{}",
      ak: "AKIAIOSFODNN7EXAMPLE",
      sk: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });

    expect(headers).toHaveProperty("Content-Type", "application/json");
    expect(headers).toHaveProperty("Host", "open.volcengineapi.com");
    expect(headers).toHaveProperty("X-Date", "20260601T080000Z");
    expect(headers).toHaveProperty(
      "X-Content-Sha256",
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    );
    expect(headers).toHaveProperty("Authorization");
  });

  it("Authorization header has correct format", () => {
    const headers = signVolcengineRequest({
      method: "POST",
      url: "https://open.volcengineapi.com/open/GetAFPUsage",
      body: "{}",
      ak: "AKIAIOSFODNN7EXAMPLE",
      sk: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });

    const auth = headers.Authorization;
    expect(auth).toMatch(/^HMAC-SHA256 Credential=/);
    expect(auth).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(auth).toContain("/20260601/cn-beijing/ark/request");
    expect(auth).toContain("SignedHeaders=host;x-content-sha256;x-date");
    expect(auth).toContain("Signature=");
  });

  it("uses custom region and service", () => {
    const headers = signVolcengineRequest({
      method: "POST",
      url: "https://open.volcengineapi.com/open/GetAFPUsage",
      body: "{}",
      ak: "AKTEST",
      sk: "SKTEST",
      region: "ap-singapore",
      service: "ecs",
    });

    expect(headers.Authorization).toContain("/ap-singapore/ecs/request");
  });

  it("different body produces different signature", () => {
    const h1 = signVolcengineRequest({
      method: "POST",
      url: "https://open.volcengineapi.com/open/GetAFPUsage",
      body: "{}",
      ak: "AKTEST",
      sk: "SKTEST",
    });
    const h2 = signVolcengineRequest({
      method: "POST",
      url: "https://open.volcengineapi.com/open/GetAFPUsage",
      body: '{"key":"value"}',
      ak: "AKTEST",
      sk: "SKTEST",
    });

    const sig1 = h1.Authorization.match(/Signature=([a-f0-9]+)/)?.[1];
    const sig2 = h2.Authorization.match(/Signature=([a-f0-9]+)/)?.[1];
    expect(sig1).not.toBe(sig2);
  });

  it("same inputs produce same signature (deterministic)", () => {
    const opts = {
      method: "POST" as const,
      url: "https://open.volcengineapi.com/open/GetAFPUsage",
      body: "{}",
      ak: "AKTEST",
      sk: "SKTEST",
    };
    const h1 = signVolcengineRequest(opts);
    const h2 = signVolcengineRequest(opts);
    expect(h1.Authorization).toBe(h2.Authorization);
  });

  it("includes query string in canonical request", () => {
    const headers = signVolcengineRequest({
      method: "GET",
      url: "https://open.volcengineapi.com/open/GetAFPUsage?foo=bar&baz=qux",
      body: "",
      ak: "AKTEST",
      sk: "SKTEST",
    });

    // Just verify it doesn't throw and produces valid auth header
    expect(headers.Authorization).toMatch(/^HMAC-SHA256/);
  });
});
