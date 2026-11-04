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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("登录页", () => {
  it("登录成功后按 isInitial 跳到强制改密页", async () => {
    const fetchMock = stubFetch({
      "GET /api/auth/session": anonymous,
      "GET /api/auth/is-initial": { body: { isInitial: true } },
      "POST /api/auth/login": {
        body: {
          user: {
            id: "1",
            username: "admin",
            name: "admin",
            email: "admin@local",
            isInitial: true,
          },
        },
      },
    });

    const { history } = renderAt("/login");

    await screen.findByText(/首次登录，请使用默认凭据登录并修改密码/);
    fireEvent.input(screen.getByPlaceholderText("请输入用户名"), {
      target: { value: "admin" },
    });
    fireEvent.input(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "admin123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(history.get()).toBe("/change-password?force=1"));

    const loginCall = fetchMock.mock.calls.find(([url, init]) => {
      return String(url).endsWith("/api/auth/login") && init?.method === "POST";
    });
    expect(loginCall).toBeTruthy();
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      username: "admin",
      password: "admin123",
    });
  });

  it("已改密的账号登录后直接进入订阅页", async () => {
    stubFetch({
      "GET /api/auth/session": anonymous,
      "GET /api/auth/is-initial": { body: { isInitial: false } },
      "POST /api/auth/login": {
        body: {
          user: {
            id: "1",
            username: "admin",
            name: "admin",
            email: "admin@local",
            isInitial: false,
          },
        },
      },
    });

    const { history } = renderAt("/login");

    await screen.findByPlaceholderText("请输入用户名");
    fireEvent.input(screen.getByPlaceholderText("请输入用户名"), {
      target: { value: "admin" },
    });
    fireEvent.input(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(history.get()).toBe("/subscriptions"));
  });

  it("凭据错误时展示服务端错误信息且停留在登录页", async () => {
    stubFetch({
      "GET /api/auth/session": anonymous,
      "GET /api/auth/is-initial": { body: { isInitial: false } },
      "POST /api/auth/login": {
        status: 401,
        body: { error: "用户名或密码错误" },
      },
    });

    const { history } = renderAt("/login");

    await screen.findByPlaceholderText("请输入用户名");
    fireEvent.input(screen.getByPlaceholderText("请输入用户名"), {
      target: { value: "admin" },
    });
    fireEvent.input(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "用户名或密码错误"
    );
    expect(history.get()).toBe("/login");
  });

  it("被限流时展示 429 的错误信息", async () => {
    stubFetch({
      "GET /api/auth/session": anonymous,
      "GET /api/auth/is-initial": { body: { isInitial: false } },
      "POST /api/auth/login": {
        status: 429,
        body: { error: "尝试次数过多，请15分钟后再试" },
      },
    });

    renderAt("/login");

    await screen.findByPlaceholderText("请输入用户名");
    fireEvent.input(screen.getByPlaceholderText("请输入用户名"), {
      target: { value: "admin" },
    });
    fireEvent.input(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "尝试次数过多，请15分钟后再试"
    );
  });
});
