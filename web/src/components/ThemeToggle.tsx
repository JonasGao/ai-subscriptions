import type { Component } from "solid-js";
import { themeStore } from "../theme";

const THEME_TITLES: Record<string, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function ThemeIcon(props: { theme: string }) {
  if (props.theme === "light") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path
          d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    );
  }
  if (props.theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect
        x="3"
        y="4"
        width="18"
        height="13"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  );
}

/**
 * ThemeToggle cycles light → dark → system, mirroring the old stack's
 * components/ThemeToggle.tsx. The current choice is persisted by the store.
 */
export const ThemeToggle: Component = () => {
  const store = themeStore();

  return (
    <button
      type="button"
      class="theme-toggle ghost"
      onClick={store.cycleTheme}
      title={`当前主题: ${store.theme()}`}
      aria-label={`切换主题（当前: ${THEME_TITLES[store.theme()]}）`}
    >
      <ThemeIcon theme={store.theme()} />
    </button>
  );
};
