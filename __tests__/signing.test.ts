import { describe, it, expect } from "vitest";
import {
  computeDingtalkSign,
  computeFeishuSign,
} from "@/lib/notifications/signing";

describe("computeDingtalkSign", () => {
  it("returns null when secret is empty", () => {
    expect(computeDingtalkSign(undefined, 1700000000000)).toBeNull();
    expect(computeDingtalkSign("", 1700000000000)).toBeNull();
  });

  it("produces deterministic sign for a given (secret, timestamp)", () => {
    const a = computeDingtalkSign("test-secret", 1700000000000);
    const b = computeDingtalkSign("test-secret", 1700000000000);
    expect(a).toEqual(b);
    expect(a?.timestamp).toBe(1700000000000);
    expect(typeof a?.sign).toBe("string");
    expect(a!.sign.length).toBeGreaterThan(0);
  });

  it("different secrets yield different signs", () => {
    const a = computeDingtalkSign("secret-a", 1700000000000);
    const b = computeDingtalkSign("secret-b", 1700000000000);
    expect(a!.sign).not.toBe(b!.sign);
  });

  it("different timestamps yield different signs", () => {
    const a = computeDingtalkSign("secret", 1700000000000);
    const b = computeDingtalkSign("secret", 1700000001000);
    expect(a!.sign).not.toBe(b!.sign);
  });

  it("sign is URL-safe (percent-encoded)", () => {
    const result = computeDingtalkSign("secret", 1700000000000);
    // The sign output goes into a URL query param; encodeURIComponent ensures
    // no raw '+' or '/' leak through. The decoded form must be valid base64.
    const decoded = decodeURIComponent(result!.sign);
    expect(decoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // And if the raw form had unsafe chars, it would differ from the decoded form.
    expect(result!.sign).not.toMatch(/[+/=]/);
  });
});

describe("computeFeishuSign", () => {
  it("returns null when secret is empty", () => {
    expect(computeFeishuSign(undefined, 1754300000)).toBeNull();
    expect(computeFeishuSign("", 1754300000)).toBeNull();
  });

  // Reference value generated via Node's crypto with the documented Feishu
  // algorithm: key = `timestamp + "\n" + secret`, data = "".
  //
  //   key  = "1754300000\ntest-feishu-secret"
  //   out  = base64(HMAC-SHA256(key, ""))
  //        = "TOjmNE0/gdXWiUBBctTQNdftMsBHtkNSOeswvkAA7FM="
  it("matches the official Feishu signing algorithm", () => {
    const result = computeFeishuSign("test-feishu-secret", 1754300000);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe("1754300000");
    expect(result!.sign).toBe("TOjmNE0/gdXWiUBBctTQNdftMsBHtkNSOeswvkAA7FM=");
  });

  it("returns timestamp as a string (Feishu convention)", () => {
    const result = computeFeishuSign("any-secret", 1754300000);
    expect(typeof result!.timestamp).toBe("string");
  });

  it("produces deterministic output for the same (secret, timestamp)", () => {
    const a = computeFeishuSign("secret", 1754300000);
    const b = computeFeishuSign("secret", 1754300000);
    expect(a).toEqual(b);
  });

  it("different secrets yield different signs", () => {
    const a = computeFeishuSign("secret-a", 1754300000);
    const b = computeFeishuSign("secret-b", 1754300000);
    expect(a!.sign).not.toBe(b!.sign);
  });

  it("different timestamps yield different signs", () => {
    const a = computeFeishuSign("secret", 1754300000);
    const b = computeFeishuSign("secret", 1754300001);
    expect(a!.sign).not.toBe(b!.sign);
  });

  it("sign is standard base64 (NOT URL-encoded — goes in body)", () => {
    // Unlike DingTalk, Feishu signs live in the JSON body and must be plain
    // base64 — raw '+' and '/' are allowed, and trailing '=' padding is kept.
    const result = computeFeishuSign("secret", 1754300000);
    expect(result!.sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
