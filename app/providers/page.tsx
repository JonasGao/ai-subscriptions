"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, ExternalLink, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  EnrichedProvider,
  UnregisteredProviderName,
} from "@/lib/providers/enrichment";

function UrlRow({ label, url }: { label: string; url?: string }) {
  if (!url) return null;
  return (
    <div className="text-xs text-muted-foreground break-all">
      <span className="font-medium text-foreground">{label}：</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
      >
        {url}
      </a>
    </div>
  );
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<EnrichedProvider[] | null>(null);
  const [unregistered, setUnregistered] = useState<UnregisteredProviderName[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [providersRes, unregisteredRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/providers/unregistered"),
      ]);
      if (!providersRes.ok) throw new Error(`HTTP ${providersRes.status}`);
      if (!unregisteredRes.ok)
        throw new Error(`HTTP ${unregisteredRes.status}`);
      setProviders(await providersRes.json());
      setUnregistered(await unregisteredRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center h-[400px] text-muted-foreground">
          加载中...
        </div>
      </div>
    );
  }

  if (!providers) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center h-[400px] text-destructive">
          加载失败：{error}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="outline" size="icon" aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2">
              <Boxes className="h-6 w-6" />
              服务商管理
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              浏览预定义服务商的完整配置与引用情况（只读）
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-center gap-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
            <XCircle className="h-5 w-5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100"
            >
              ×
            </button>
          </div>
        )}

        {/* Provider list */}
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-lg">{provider.name}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {provider.id}
                  </span>
                  {provider.supportsBalanceQuery && (
                    <Badge variant="success">支持余额查询</Badge>
                  )}
                  {provider.supportsUsageQuery && (
                    <Badge variant="secondary">支持用量查询</Badge>
                  )}
                </div>
                {provider.description && (
                  <CardDescription>{provider.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {provider.subscriptionCount} 个订阅 · {provider.toolCount}{" "}
                  个工具
                </div>

                {provider.website && (
                  <div className="text-xs">
                    <a
                      href={provider.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:underline break-all"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {provider.website}
                    </a>
                  </div>
                )}

                <UrlRow label="余额查询 API" url={provider.balanceApiUrl} />
                <UrlRow label="用量查询 API" url={provider.usageApiUrl} />

                {provider.credentialFields &&
                  provider.credentialFields.length > 0 && (
                    <div>
                      <div className="text-xs font-medium mb-1">凭据字段</div>
                      <div className="flex flex-wrap gap-1.5">
                        {provider.credentialFields.map((field) => (
                          <Badge
                            key={field.key}
                            variant="outline"
                            className="font-normal"
                          >
                            {field.label}（{field.key} ·{" "}
                            {field.type === "password" ? "密码" : "文本"}）
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                {provider.plans && provider.plans.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">方案</div>
                    <div className="space-y-1">
                      {provider.plans.map((plan) => (
                        <div
                          key={plan.id}
                          className="text-xs text-muted-foreground"
                        >
                          <span className="font-medium text-foreground">
                            {plan.name}
                          </span>
                          <span className="mx-1">·</span>
                          {plan.id}
                          {plan.usageApiUrl && (
                            <div className="break-all pl-2">
                              {plan.usageApiUrl}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Unregistered provider names */}
        <div>
          <h2 className="text-xl font-semibold mb-1">未注册的服务商名称</h2>
          <p className="text-sm text-muted-foreground mb-4">
            订阅或工具选择「其他」时填写的自定义名称，按使用次数统计。
          </p>
          {unregistered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                暂无使用中的自定义服务商名称。
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4">
                <div className="divide-y">
                  {unregistered.map((item) => (
                    <div
                      key={item.name}
                      className="py-2 flex items-center justify-between gap-4"
                    >
                      <span className="font-medium truncate">{item.name}</span>
                      <Badge variant="secondary">{item.count} 次使用</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
