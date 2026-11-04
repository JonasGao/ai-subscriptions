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

    await waitFor(() =>
      expect(history.get()).toBe("/subscriptions")
    );
    expect(await screen.findByText("还没有订阅，点击「添加订阅」开始记录。")).toBeTruthy();
  });
});
