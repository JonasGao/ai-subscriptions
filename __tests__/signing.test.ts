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
    expect(computeFeishuSign(undefined, 1700000000)).toBeNull();
    expect(computeFeishuSign("", 1700000000)).toBeNull();
  });

  it("produces deterministic sign", () => {
    const a = computeFeishuSign("test-secret", 1700000000);
    const b = computeFeishuSign("test-secret", 1700000000);
    expect(a).toEqual(b);
  });

  it("sign is raw base64 (not URL-encoded)", () => {
    const result = computeFeishuSign("test-secret", 1700000000);
    // Feishu sign lives in the payload body, not the URL.
    expect(result!.sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
