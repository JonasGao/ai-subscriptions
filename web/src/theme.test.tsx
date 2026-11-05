import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  createThemeStore,
  resetThemeStoreForTest,
  resolveTheme,
} from "./theme";
import { ThemeToggle } from "./components/ThemeToggle";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  resetThemeStoreForTest();
});

afterEach(cleanup);

describe("theme tokens", () => {
  it("resolves system to the OS preference and explicit themes as-is", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("applies the resolved theme as a class and color-scheme", () => {
    const store = createThemeStore({
      prefersDark: () => true,
      root: document.documentElement,
    });

    expect(store.theme()).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    store.setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists the chosen theme and restores it on the next boot", () => {
    const store = createThemeStore({ root: document.documentElement });
    store.setTheme("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    const restored = createThemeStore({ root: document.documentElement });
    expect(restored.theme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("cycles light → dark → system → light", () => {
    const store = createThemeStore({ root: document.documentElement });

    store.setTheme("light");
    store.cycleTheme();
    expect(store.theme()).toBe("dark");
    store.cycleTheme();
    expect(store.theme()).toBe("system");
    store.cycleTheme();
    expect(store.theme()).toBe("light");
  });
});

describe("ThemeToggle", () => {
  it("shows the current theme and persists the next one when clicked", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    resetThemeStoreForTest();

    render(() => <ThemeToggle />);
    const button = screen.getByRole("button", { name: /切换主题/ });
    expect(button.getAttribute("title")).toBe("当前主题: light");

    fireEvent.click(button);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(button.getAttribute("title")).toBe("当前主题: dark");
  });

  it("swaps the icon as the theme cycles", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    resetThemeStoreForTest();

    render(() => <ThemeToggle />);
    const button = screen.getByRole("button", { name: /切换主题/ });
    // light = sun (a circle), dark = moon (a path-only crescent).
    expect(button.querySelector("circle")).not.toBeNull();

    fireEvent.click(button); // light -> dark
    expect(button.querySelector("circle")).toBeNull();

    fireEvent.click(button); // dark -> system
    expect(button.querySelector("circle")).toBeNull();
    expect(button.querySelector("rect")).not.toBeNull();
  });
});
