import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGithubModels } from "@/lib/providers/github";

// ── helpers ─────────────────────────────────────────────────────────────────

function mockResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const baseCreds = { token: "ghp_test_token" };

// ── fetchGithubModels ───────────────────────────────────────────────────────

describe("fetchGithubModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when token is missing", async () => {
    await expect(fetchGithubModels({})).rejects.toThrow("Token 未配置");
    await expect(fetchGithubModels({ token: "" })).rejects.toThrow(
      "Token 未配置"
    );
  });

  it("exchanges PAT for Copilot token then fetches models", async () => {
    const tokenExchangeResponse = {
      token: "copilot_token_123",
      expires_at: 1730000000000,
      endpoints: { api: "https://api.githubcopilot.com" },
    };

    const modelsResponse = {
      data: [
        {
          id: "gpt-4",
          name: "GPT-4",
          capabilities: { type: "chat" },
          policy: { state: "enabled" },
        },
        {
          id: "gpt-3.5",
          name: "GPT-3.5",
          capabilities: { type: "chat" },
          policy: { state: "enabled" },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(tokenExchangeResponse))
      .mockResolvedValueOnce(mockResponse(modelsResponse));

    const result = await fetchGithubModels(baseCreds);

    expect(result).toEqual(["gpt-4", "gpt-3.5"]);

    const fetchSpy = vi.mocked(globalThis.fetch);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Token exchange call
    const [exchangeUrl, exchangeOpts] = fetchSpy.mock.calls[0];
    expect(exchangeUrl).toBe(
      "https://api.github.com/copilot_internal/v2/token"
    );
    const exchangeHeaders = exchangeOpts!.headers as Record<string, string>;
    expect(exchangeHeaders.Authorization).toBe("token ghp_test_token");
    expect(exchangeHeaders["Editor-Version"]).toBe("vscode/1.96.2");

    // Models call
    const [modelsUrl, modelsOpts] = fetchSpy.mock.calls[1];
    expect(modelsUrl).toBe("https://api.githubcopilot.com/models");
    const modelsHeaders = modelsOpts!.headers as Record<string, string>;
    expect(modelsHeaders.Authorization).toBe("Bearer copilot_token_123");
  });

  it("filters by policy.state === 'enabled' and capabilities.type === 'chat'", async () => {
    const tokenExchangeResponse = {
      token: "copilot_token",
      expires_at: 1730000000000,
      endpoints: { api: "https://api.githubcopilot.com" },
    };

    const modelsResponse = {
      data: [
        {
          id: "gpt-4",
          capabilities: { type: "chat" },
          policy: { state: "enabled" },
        },
        {
          id: "embedding-ada",
          capabilities: { type: "embeddings" },
          policy: { state: "enabled" },
        },
        {
          id: "gpt-3.5-disabled",
          capabilities: { type: "chat" },
          policy: { state: "disabled" },
        },
        {
          id: "claude",
          capabilities: { type: "chat" },
          policy: { state: "enabled" },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(tokenExchangeResponse))
      .mockResolvedValueOnce(mockResponse(modelsResponse));

    const result = await fetchGithubModels(baseCreds);

    expect(result).toEqual(["gpt-4", "claude"]);
  });

  it("returns empty array when no models pass filter", async () => {
    const tokenExchangeResponse = {
      token: "copilot_token",
      expires_at: 1730000000000,
      endpoints: { api: "https://api.githubcopilot.com" },
    };

    const modelsResponse = {
      data: [
        {
          id: "embedding-ada",
          capabilities: { type: "embeddings" },
          policy: { state: "enabled" },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(tokenExchangeResponse))
      .mockResolvedValueOnce(mockResponse(modelsResponse));

    const result = await fetchGithubModels(baseCreds);

    expect(result).toEqual([]);
  });

  it("throws on token exchange failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "bad credentials" }, 401)
    );

    await expect(fetchGithubModels(baseCreds)).rejects.toThrow(
      "Token exchange API returned 401"
    );
  });

  it("throws on models API failure", async () => {
    const tokenExchangeResponse = {
      token: "copilot_token",
      expires_at: 1730000000000,
      endpoints: { api: "https://api.githubcopilot.com" },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(tokenExchangeResponse))
      .mockResolvedValueOnce(mockResponse({ message: "forbidden" }, 403));

    await expect(fetchGithubModels(baseCreds)).rejects.toThrow(
      "Copilot models API returned 403"
    );
  });

  it("handles missing data field gracefully", async () => {
    const tokenExchangeResponse = {
      token: "copilot_token",
      expires_at: 1730000000000,
      endpoints: { api: "https://api.githubcopilot.com" },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(tokenExchangeResponse))
      .mockResolvedValueOnce(mockResponse({}));

    const result = await fetchGithubModels(baseCreds);

    expect(result).toEqual([]);
  });

  it("does not reuse the cached Copilot token across different PATs", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = ((init?.headers ?? {}) as Record<string, string>) ?? {};
      calls.push({ url, auth: headers["Authorization"] });
      if (url.includes("copilot_internal/v2/token")) {
        const pat = (headers["Authorization"] ?? "").replace(/^token /, "");
        return mockResponse({
          token: `copilot_for_${pat}`,
          expires_at: Date.now() + 30 * 60 * 1000,
          endpoints: { api: "https://api.githubcopilot.com" },
        });
      }
      return mockResponse({
        data: [
          {
            id: "claude-sonnet-4",
            capabilities: { type: "chat" },
            policy: { state: "enabled" },
          },
        ],
      });
    });

    await fetchGithubModels({ token: "ghp_AAA" });
    await fetchGithubModels({ token: "ghp_BBB" });

    // A different PAT must re-exchange rather than reuse the other
    // subscription's cached Copilot token.
    const exchanges = calls.filter((c) =>
      c.url.includes("copilot_internal/v2/token")
    );
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].auth).toBe("token ghp_AAA");
    expect(exchanges[1].auth).toBe("token ghp_BBB");

    // Same PAT within the TTL reuses the cache — no third exchange.
    await fetchGithubModels({ token: "ghp_BBB" });
    expect(
      calls.filter((c) => c.url.includes("copilot_internal/v2/token"))
    ).toHaveLength(2);
  });
});
