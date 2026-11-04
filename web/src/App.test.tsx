import { render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("欢迎页", () => {
  it("渲染产品标题与骨架说明", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }),
    );

    render(() => <App />);

    expect(screen.getByRole("heading", { name: "AI订阅管理工具" })).toBeTruthy();
    expect(screen.getByText(/Go \+ SolidJS 单二进制骨架/)).toBeTruthy();
  });

  it("健康检查成功时显示后端已连接", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }),
    );

    render(() => <App />);

    await waitFor(() => expect(screen.getByText(/后端已连接/)).toBeTruthy());
  });

  it("健康检查失败时显示后端不可用", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(() => <App />);

    await waitFor(() => expect(screen.getByText(/后端不可用/)).toBeTruthy());
  });
});
