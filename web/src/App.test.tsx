import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { stubFetch } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("应用外壳", () => {
  it("未登录时无论入口路径都落到登录页", async () => {
    stubFetch({
      "GET /api/auth/session": { body: {} },
      "GET /api/auth/is-initial": { body: { isInitial: true } },
    });

    render(() => <App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "登录" })).toBeTruthy()
    );
    expect(screen.getByRole("heading", { name: "AI订阅管理" })).toBeTruthy();
  });
});
