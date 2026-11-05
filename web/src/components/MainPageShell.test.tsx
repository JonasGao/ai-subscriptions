// Parity port of __tests__/MainPageShell.test.tsx (1 case, docs/parity-matrix.md).

import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainPageShell } from "./MainPageShell";

vi.mock("./ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

describe("MainPageShell", () => {
  afterEach(cleanup);

  it("links every main page to its own path and marks the active page", () => {
    render(() => (
      <MainPageShell activePage="tools">
        <p>页面内容</p>
      </MainPageShell>
    ));

    expect(
      screen.getByRole("link", { name: "订阅" }).getAttribute("href")
    ).toBe("/subscriptions");
    expect(
      screen.getByRole("link", { name: "工具" }).getAttribute("href")
    ).toBe("/tools");
    expect(
      screen.getByRole("link", { name: "代理订阅" }).getAttribute("href")
    ).toBe("/proxy-subscriptions");
    expect(
      screen.getByRole("link", { name: "通知" }).getAttribute("href")
    ).toBe("/notifications");
    expect(
      screen.getByRole("link", { name: "工具" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "订阅" }).hasAttribute("aria-current")
    ).toBe(false);
    expect(screen.getByText("页面内容")).toBeTruthy();
  });
});
