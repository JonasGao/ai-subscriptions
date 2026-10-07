import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/subscriptions/[id]/models/route";
import { getSubscriptionById, getProviders } from "@/lib/db";
import { decryptCredentials } from "@/lib/encryption";
import { defaultProviders, type Subscription } from "@/lib/types";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  getSubscriptionById: vi.fn(),
  getProviders: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  decryptCredentials: vi.fn(() => ({ apiKey: "decrypted-key" })),
}));

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
    provider: "deepseek",
    subscriptionType: "one-time",
    price: 10,
    status: "active",
    hasCredentials: false,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new Request(
    "http://localhost/api/subscriptions/sub-1/models"
  ) as unknown as NextRequest;
}

describe("GET /api/subscriptions/[id]/models credentials gating", () => {
  beforeEach(() => {
    vi.mocked(getProviders).mockReturnValue(defaultProviders);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serves models without credentials for public endpoints (alibaba coding-plan)", async () => {
    vi.mocked(getSubscriptionById).mockReturnValue(
      makeSubscription({
        provider: "alibaba",
        planId: "coding-plan",
        subscriptionType: "recurring",
      })
    );
    const outboundFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: "list",
        data: [{ id: "qwen3-coder-plus" }, { id: "glm-5" }],
      }),
    });
    vi.stubGlobal("fetch", outboundFetch);

    const res = await GET(makeRequest(), { params: { id: "sub-1" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual(["glm-5", "qwen3-coder-plus"]); // sorted

    // Outbound call hits the public endpoint with no auth header and
    // never touches decryption.
    expect(outboundFetch).toHaveBeenCalledWith(
      "https://coding.dashscope.aliyuncs.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: {},
      })
    );
    expect(decryptCredentials).not.toHaveBeenCalled();
  });

  it("rejects credential-less subscriptions for auth-required endpoints", async () => {
    vi.mocked(getSubscriptionById).mockReturnValue(
      makeSubscription({ provider: "deepseek" })
    );

    const res = await GET(makeRequest(), { params: { id: "sub-1" } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Credentials");
  });

  it("decrypts and forwards credentials for auth-required endpoints", async () => {
    vi.mocked(getSubscriptionById).mockReturnValue(
      makeSubscription({
        provider: "deepseek",
        credentials: "v1:encrypted-blob",
        hasCredentials: true,
      })
    );
    const outboundFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "deepseek-chat" }] }),
    });
    vi.stubGlobal("fetch", outboundFetch);

    const res = await GET(makeRequest(), { params: { id: "sub-1" } });

    expect(res.status).toBe(200);
    expect(decryptCredentials).toHaveBeenCalledWith("v1:encrypted-blob");
    expect(outboundFetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer decrypted-key" },
      })
    );
  });
});
