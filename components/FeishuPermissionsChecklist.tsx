"use client";

import { useState } from "react";
import { Shield, ChevronDown, MessageSquare, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  FEISHU_PERMISSIONS,
  FEISHU_OPEN_PLATFORM_APP_URL,
  FEISHU_OPEN_PLATFORM_ROOT,
  FEISHU_WEBSOCKET_EVENT_HINT,
  FEISHU_LISTEN_EVENT_KEY,
} from "@/lib/notifications/feishu-permissions";

/**
 * Collapsible checklist of Feishu scopes required by the feishu-app channel.
 *
 * Self-contained: owns its own open/closed state. Accepts `appId` so the
 * deep link can point at the right app's permission page when known.
 */
export function FeishuPermissionsChecklist({ appId }: { appId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors rounded-md"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          所需飞书权限清单
          <Badge variant="outline" className="text-[10px] px-1.5">
            {FEISHU_PERMISSIONS.length}
          </Badge>
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-amber-200 dark:border-amber-900/60">
          <p className="text-xs text-muted-foreground">
            请在飞书开放平台后台为应用开通以下权限,否则发消息 / 辅助获取 /
            长连接监听会报错。
          </p>
          <ul className="space-y-2">
            {FEISHU_PERMISSIONS.map((perm) => (
              <li
                key={perm.scope}
                className="rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {perm.scope}
                      </code>
                      <span className="text-muted-foreground">{perm.name}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      {perm.purpose}
                    </p>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>用于:</span>
                      {perm.usedBy.map((u) => (
                        <Badge
                          key={u}
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {u}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="rounded-md border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <div className="flex items-start gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <p className="leading-relaxed">{FEISHU_WEBSOCKET_EVENT_HINT}</p>
            </div>
            <p className="text-[11px] text-muted-foreground pl-5">
              事件 key:{" "}
              <code className="font-mono bg-background/60 px-1 rounded">
                {FEISHU_LISTEN_EVENT_KEY}
              </code>
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            {appId.trim() ? (
              <a
                href={FEISHU_OPEN_PLATFORM_APP_URL.replace(
                  "{appId}",
                  appId.trim()
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                打开飞书开放平台权限页 (应用 {appId.trim()})
              </a>
            ) : (
              <a
                href={FEISHU_OPEN_PLATFORM_ROOT}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                打开飞书开放平台后台
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
