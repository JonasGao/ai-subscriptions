import Link from "next/link";
import { Bell, Boxes, CreditCard, Settings, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

export type MainPage = "subscriptions" | "tools" | "proxy-subscriptions";

interface MainPageShellProps {
  activePage: MainPage;
  children: React.ReactNode;
}

const mainPages = [
  {
    id: "subscriptions" as const,
    href: "/subscriptions",
    label: "订阅",
    icon: CreditCard,
  },
  {
    id: "tools" as const,
    href: "/tools",
    label: "工具",
    icon: Wrench,
  },
  {
    id: "proxy-subscriptions" as const,
    href: "/proxy-subscriptions",
    label: "代理订阅",
    icon: Boxes,
  },
];

export function MainPageShell({ activePage, children }: MainPageShellProps) {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <h1 className="text-xl font-bold md:text-3xl">AI订阅管理</h1>
          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="主要页面"
              className="flex overflow-hidden rounded-md border"
            >
              {mainPages.map(({ id, href, label, icon: Icon }) => (
                <Button
                  key={id}
                  asChild
                  variant={activePage === id ? "default" : "ghost"}
                  className="rounded-none border-0"
                >
                  <Link
                    href={href}
                    aria-current={activePage === id ? "page" : undefined}
                  >
                    <Icon className="mr-1 h-4 w-4" />
                    {label}
                  </Link>
                </Button>
              ))}
            </nav>
            <ThemeToggle />
            <Button asChild variant="outline" size="icon">
              <Link
                href="/providers"
                title="服务商管理"
                aria-label="服务商管理"
              >
                <Boxes className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon">
              <Link
                href="/notifications"
                title="通知设置"
                aria-label="通知设置"
              >
                <Bell className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon">
              <Link
                href="/change-password"
                title="修改密码"
                aria-label="修改密码"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
