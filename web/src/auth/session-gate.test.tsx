import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "../test-utils";

const anonymous = { body: {} };
const seedSession = {
  body: {
    user: {
      id: "1",
      username: "admin",
      name: "admin",
      email: "admin@local",
      isInitial: true,
    },
  },
};
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
});

describe("路由门禁", () => {
  it("未登录访问订阅页会重定向到登录页", async () => {
    stubFetch({
      "GET /api/auth/session": anonymous,
      "GET /api/auth/is-initial": { body: { isInitial: false } },
    });

    const { history } = renderAt("/subscriptions");

    await waitFor(() => expect(history.get()).toBe("/login"));
    expect(await screen.findByRole("button", { name: "登录" })).toBeTruthy();
  });

  it("未登录访问任意未知页面也会重定向到登录页", async () => {
    stubFetch({
      "GET /api/auth/session": anonymous,
      "GET /api/auth/is-initial": { body: { isInitial: false } },
    });

    const { history } = renderAt("/tools");

    await waitFor(() => expect(history.get()).toBe("/login"));
  });

  it("种子密码会话被强制送去改密页", async () => {
    stubFetch({ "GET /api/auth/session": seedSession });

    const { history } = renderAt("/subscriptions");

    await waitFor(() => expect(history.get()).toBe("/change-password?force=1"));
    expect(
      await screen.findByRole("heading", { name: "首次登录，请修改密码" })
    ).toBeTruthy();
  });

  it("已登录访问登录页会重定向到订阅页", async () => {
    stubFetch({ "GET /api/auth/session": activeSession });

    const { history } = renderAt("/login");

    await waitFor(() => expect(history.get()).toBe("/subscriptions"));
    expect(await screen.findByText(/已登录：admin/)).toBeTruthy();
  });

  it("登录后进入受保护壳页，登出会回到登录页", async () => {
    const fetchMock = stubFetch({
      "GET /api/auth/session": activeSession,
      "POST /api/auth/logout": { body: { success: true } },
      "GET /api/auth/is-initial": { body: { isInitial: false } },
    });

    const { history } = renderAt("/subscriptions");

    expect(await screen.findByText(/已登录：admin/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(history.get()).toBe("/login"));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/api/auth/logout") && init?.method === "POST"
      )
    ).toBe(true);
  });
});

describe("根路径", () => {
  it("已登录访问 / 会被送到 /subscriptions", async () => {
    stubFetch({ "GET /api/auth/session": activeSession });

    const { history } = renderAt("/");

    await waitFor(() => expect(history.get()).toBe("/subscriptions"));
    expect(await screen.findByText(/已登录：admin/)).toBeTruthy();
  });
});
