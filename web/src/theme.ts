import { createSignal, type Accessor } from "solid-js";

/** Theme is the user's stored choice; "system" follows the OS preference. */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const THEMES: Theme[] = ["light", "dark", "system"];

export interface ThemeStore {
  theme: Accessor<Theme>;
  resolvedTheme: Accessor<ResolvedTheme>;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

interface ThemeStoreOptions {
  storage?: Storage | null;
  root?: HTMLElement;
  prefersDark?: () => boolean;
}

/** normalizeTheme accepts only a known stored value; anything else is system. */
export function normalizeTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * createThemeStore owns the theme signal. Every change writes the class the
 * CSS tokens key off (`light` / `dark` on <html>), the matching color-scheme,
 * and localStorage — the same contract as next-themes' attribute="class"
 * setup on the old stack, minus the library.
 */
export function createThemeStore(options: ThemeStoreOptions = {}): ThemeStore {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const root =
    options.root ??
    (typeof document === "undefined" ? undefined : document.documentElement);
  const prefersDark = options.prefersDark ?? systemPrefersDark;

  const [theme, setThemeSignal] = createSignal<Theme>(
    normalizeTheme(storage?.getItem(THEME_STORAGE_KEY))
  );

  const resolvedTheme = () => resolveTheme(theme(), prefersDark());

  const apply = () => {
    if (!root) return;
    const resolved = resolvedTheme();
    root.classList.toggle("dark", resolved === "dark");
    root.classList.toggle("light", resolved === "light");
    root.style.colorScheme = resolved;
  };

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme() === "system") apply();
    };
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
    } else if (typeof query.addListener === "function") {
      query.addListener(onChange);
    }
  }

  const setTheme = (next: Theme) => {
    setThemeSignal(next);
    storage?.setItem(THEME_STORAGE_KEY, next);
    apply();
  };

  const cycleTheme = () => {
    const index = THEMES.indexOf(theme());
    setTheme(THEMES[(index + 1) % THEMES.length]);
  };

  apply();

  return { theme, resolvedTheme, setTheme, cycleTheme };
}

let singleton: ThemeStore | undefined;

/** themeStore lazily returns the app-wide store (one per page load). */
export function themeStore(): ThemeStore {
  if (!singleton) singleton = createThemeStore();
  return singleton;
}

/** resetThemeStoreForTest drops the singleton so tests can re-boot it. */
export function resetThemeStoreForTest(): void {
  singleton = undefined;
}
