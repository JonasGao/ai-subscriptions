// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainPageShell } from "@/components/MainPageShell";

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

describe("MainPageShell", () => {
  afterEach(cleanup);

  it("links every main page to its own path and marks the active page", () => {
    const result = render(
      <MainPageShell activePage="tools">
        <p>页面内容</p>
      </MainPageShell>
    );

    expect(
      result.getByRole("link", { name: "订阅" }).getAttribute("href")
    ).toBe("/subscriptions");
    expect(
      result.getByRole("link", { name: "工具" }).getAttribute("href")
    ).toBe("/tools");
    expect(
      result.getByRole("link", { name: "代理订阅" }).getAttribute("href")
    ).toBe("/proxy-subscriptions");
    expect(result.getByRole("link", { name: "工具" })).toHaveProperty(
      "ariaCurrent",
      "page"
    );
    expect(
      result.getByRole("link", { name: "订阅" }).hasAttribute("aria-current")
    ).toBe(false);
    expect(result.getByText("页面内容")).toBeTruthy();
  });
});
