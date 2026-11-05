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

describe("通知路由", () => {
  it("renders /notifications for a signed-in user and marks the nav entry", async () => {
    stubFetch({
      "GET /api/auth/session": activeSession,
      "GET /api/notifications": {
        body: { channels: [], defaultLowBalanceThreshold: 10 },
      },
    });

    const { history } = renderAt("/notifications");

    expect(await screen.findByText("通知设置")).toBeTruthy();
    expect(history.get()).toBe("/notifications");
    expect(
      screen.getByRole("link", { name: "通知" }).getAttribute("aria-current")
    ).toBe("page");
  });

  it("redirects anonymous visitors from /notifications to /login", async () => {
    stubFetch({
      "GET /api/auth/session": {
        status: 401,
        body: { error: "未登录" },
      },
    });

    const { history } = renderAt("/notifications");

    await waitFor(() => expect(history.get()).toBe("/login"));
  });
});
