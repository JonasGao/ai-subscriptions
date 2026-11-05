// Page-level coverage for the read-only provider registry (#43): identity,
// capability badges, plan rows and the unregistered provider section. The old
// stack shipped this page without tests (see docs/parity-matrix.md).

import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProvidersPage } from "./ProvidersPage";
import { stubFetch } from "../test-utils";

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 系列",
    website: "https://anthropic.com",
    supportsBalanceQuery: false,
    supportsUsageQuery: false,
    supportsModelsQuery: false,
    subscriptionCount: 0,
    toolCount: 0,
    ...overrides,
  };
}

function routes(
  providers: unknown[],
  unregistered: unknown[] = []
): Record<string, { body: unknown }> {
  return {
    "GET /api/providers": { body: providers },
    "GET /api/providers/unregistered": { body: unregistered },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProvidersPage", () => {
  it("renders provider identity, reference counts and the website link", async () => {
    stubFetch(
      routes(
        [
          makeProvider({
            subscriptionCount: 2,
            toolCount: 1,
            balanceApiUrl: "https://api.anthropic.com/balance",
          }),
        ],
        []
      )
    );

    render(() => <ProvidersPage />);

    await waitFor(() => expect(screen.getByText("Anthropic")).toBeTruthy());
    expect(screen.getByText("anthropic")).toBeTruthy();
    expect(screen.getByText("Claude 系列")).toBeTruthy();
    expect(screen.getByText(/2 个订阅.*1 个工具/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "https://anthropic.com" })
        .getAttribute("href")
    ).toBe("https://anthropic.com");
    expect(
      screen
        .getByRole("link", { name: "https://api.anthropic.com/balance" })
        .getAttribute("href")
    ).toBe("https://api.anthropic.com/balance");
  });

  it("shows a badge for each supported capability query", async () => {
    stubFetch(
      routes([
        makeProvider({
          id: "all-capabilities",
          name: "全能服务商",
          supportsBalanceQuery: true,
          supportsUsageQuery: true,
          supportsModelsQuery: true,
        }),
        makeProvider({ id: "plain", name: "普通服务商" }),
      ])
    );

    render(() => <ProvidersPage />);

    await waitFor(() => expect(screen.getByText("全能服务商")).toBeTruthy());
    expect(screen.getByText("支持余额查询")).toBeTruthy();
    expect(screen.getByText("支持用量查询")).toBeTruthy();
    expect(screen.getByText("支持模型查询")).toBeTruthy();

    // The second provider supports nothing, so each badge appears exactly once.
    expect(screen.getAllByText("支持余额查询")).toHaveLength(1);
    expect(screen.getAllByText("支持用量查询")).toHaveLength(1);
    expect(screen.getAllByText("支持模型查询")).toHaveLength(1);
  });

  it("lists plans with their own capability URLs", async () => {
    stubFetch(
      routes([
        makeProvider({
          plans: [
            {
              id: "pro",
              name: "Pro 方案",
              usageApiUrl: "https://api.anthropic.com/pro/usage",
              modelsApiUrl: "https://api.anthropic.com/pro/models",
            },
          ],
        }),
      ])
    );

    render(() => <ProvidersPage />);

    await waitFor(() => expect(screen.getByText("Pro 方案")).toBeTruthy());
    expect(screen.getByText("pro")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "https://api.anthropic.com/pro/usage" })
        .getAttribute("href")
    ).toBe("https://api.anthropic.com/pro/usage");
    expect(
      screen
        .getByRole("link", { name: "https://api.anthropic.com/pro/models" })
        .getAttribute("href")
    ).toBe("https://api.anthropic.com/pro/models");
  });

  it("renders custom provider names that are in use but unregistered", async () => {
    stubFetch(
      routes(
        [makeProvider()],
        [
          { name: "某中转站", count: 7 },
          { name: "朋友合租", count: 2 },
        ]
      )
    );

    render(() => <ProvidersPage />);

    await waitFor(() => expect(screen.getByText("某中转站")).toBeTruthy());
    expect(screen.getByText("7 次使用")).toBeTruthy();
    expect(screen.getByText("朋友合租")).toBeTruthy();
    expect(screen.getByText("2 次使用")).toBeTruthy();
  });

  it("shows the empty state when no custom provider name is in use", async () => {
    stubFetch(routes([makeProvider()], []));

    render(() => <ProvidersPage />);

    await waitFor(() =>
      expect(screen.getByText("暂无使用中的自定义服务商名称。")).toBeTruthy()
    );
  });
});
