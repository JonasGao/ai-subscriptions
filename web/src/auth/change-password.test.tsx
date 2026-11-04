import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "../test-utils";

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
const changedSession = {
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

function fillPasswords(
  oldPassword: string,
  newPassword: string,
  confirm: string
) {
  fireEvent.input(screen.getByPlaceholderText(/默认密码|请输入原密码/), {
    target: { value: oldPassword },
  });
  fireEvent.input(screen.getByPlaceholderText("请输入新密码 (至少6位)"), {
    target: { value: newPassword },
  });
  fireEvent.input(screen.getByPlaceholderText("请再次输入新密码"), {
    target: { value: confirm },
  });
}

describe("改密页", () => {
  it("强制改密时展示首登标题，成功后返回登录页", async () => {
    const fetchMock = stubFetch({
      "GET /api/auth/session": seedSession,
      "POST /api/auth/change-password": { body: { success: true } },
    });

    const { history } = renderAt("/change-password?force=1");

    expect(
      await screen.findByRole("heading", { name: "首次登录，请修改密码" })
    ).toBeTruthy();

    fillPasswords("admin123", "newpass123", "newpass123");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => expect(history.get()).toBe("/login"));

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/auth/change-password")
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      oldPassword: "admin123",
      newPassword: "newpass123",
    });
  });

  it("两次新密码不一致时本地拦截，不发请求", async () => {
    const fetchMock = stubFetch({ "GET /api/auth/session": seedSession });

    renderAt("/change-password?force=1");
    await screen.findByRole("heading", { name: "首次登录，请修改密码" });

    fillPasswords("admin123", "newpass123", "different");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "两次输入的新密码不一致"
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/api/auth/change-password")
      )
    ).toBe(false);
  });

  it("新密码少于 6 位时本地拦截，不发请求", async () => {
    const fetchMock = stubFetch({ "GET /api/auth/session": seedSession });

    renderAt("/change-password?force=1");
    await screen.findByRole("heading", { name: "首次登录，请修改密码" });

    fillPasswords("admin123", "12345", "12345");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "密码长度至少6位"
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/api/auth/change-password")
      )
    ).toBe(false);
  });

  it("原密码错误时展示服务端错误信息", async () => {
    stubFetch({
      "GET /api/auth/session": changedSession,
      "POST /api/auth/change-password": {
        status: 400,
        body: { error: "原密码错误" },
      },
    });

    renderAt("/change-password");
    await screen.findByRole("heading", { name: "修改密码" });

    fillPasswords("wrong-old", "newpass123", "newpass123");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    expect((await screen.findByRole("alert")).textContent).toBe("原密码错误");
  });

  it("非强制改密页展示返回首页入口", async () => {
    stubFetch({ "GET /api/auth/session": changedSession });

    renderAt("/change-password");

    expect(
      await screen.findByRole("button", { name: "返回首页" })
    ).toBeTruthy();
  });
});
