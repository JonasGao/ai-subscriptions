import { For, type Component, type JSX } from "solid-js";
import { ThemeToggle } from "./ThemeToggle";

export type MainPage =
  "subscriptions" | "tools" | "proxy-subscriptions" | "notifications";

export interface MainPageShellProps {
  activePage: MainPage;
  children: JSX.Element;
}

const mainPages: Array<{ id: MainPage; href: string; label: string }> = [
  { id: "subscriptions", href: "/subscriptions", label: "订阅" },
  { id: "tools", href: "/tools", label: "工具" },
  {
    id: "proxy-subscriptions",
    href: "/proxy-subscriptions",
    label: "代理订阅",
  },
  { id: "notifications", href: "/notifications", label: "通知" },
];

/**
 * MainPageShell is the shared chrome for the three main pages, ported from
 * components/MainPageShell.tsx: title, the main nav (aria-current on the
 * active page), theme toggle and the change-password shortcut.
 */
export const MainPageShell: Component<MainPageShellProps> = (props) => (
  <div class="main-shell">
    <header class="main-shell-header">
      <h1 class="main-shell-title">AI订阅管理</h1>
      <div class="main-shell-actions">
        <nav aria-label="主要页面" class="main-shell-nav">
          <For each={mainPages}>
            {(page) => (
              <a
                href={page.href}
                classList={{ active: props.activePage === page.id }}
                aria-current={props.activePage === page.id ? "page" : undefined}
              >
                {page.label}
              </a>
            )}
          </For>
        </nav>
        <ThemeToggle />
        <a
          href="/change-password"
          class="main-shell-icon-link"
          title="修改密码"
          aria-label="修改密码"
        >
          设置
        </a>
      </div>
    </header>
    <div class="main-shell-content">{props.children}</div>
  </div>
);
