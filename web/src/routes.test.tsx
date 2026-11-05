import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "./test-utils";

const activeSession = {
  body: {
    user: {
      id: "1",
      username: "admin",
      name: "admin",
      email: "admin@local",
      isInitial: false,
    },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("根路径重定向", () => {
  it("redirects / to /subscriptions for a signed-in user", async () => {
    stubFetch({
      "GET /api/auth/session": activeSession,
      "GET /api/subscriptions": { body: [] },
      "GET /api/categories": { body: ["官方订阅"] },
      "GET /api/tags": { body: [] },
      "GET /api/providers": { body: [] },
    });

    const { history } = renderAt("/");

    await waitFor(() => expect(history.get()).toBe("/subscriptions"));
    expect(
      await screen.findByText("还没有订阅，点击「添加订阅」开始记录。")
    ).toBeTruthy();
  });
});

describe("服务商注册表路由", () => {
  it("renders /providers behind the session gate and exposes the nav entry", async () => {
    stubFetch({
      "GET /api/auth/session": activeSession,
      "GET /api/providers": {
        body: [
          {
            id: "anthropic",
            name: "Anthropic",
            supportsBalanceQuery: false,
            supportsUsageQuery: false,
            supportsModelsQuery: false,
            subscriptionCount: 0,
            toolCount: 0,
          },
        ],
      },
      "GET /api/providers/unregistered": { body: [] },
    });

    const { history } = renderAt("/providers");

    await waitFor(() => expect(history.get()).toBe("/providers"));
    expect(await screen.findByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("未注册的服务商名称")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "服务商管理" }).getAttribute("href")
    ).toBe("/providers");
  });
});
