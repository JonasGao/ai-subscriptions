"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Loader2,
  Plus,
  Send,
  Trash2,
  Pencil,
  CheckCircle2,
  XCircle,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotificationChannel, NotificationChannelType } from "@/lib/types";

// ============ Types ============

type ChannelView = Omit<NotificationChannel, "secret"> & {
  hasSecret: boolean;
};

interface NotificationsConfig {
  channels: ChannelView[];
  defaultLowBalanceThreshold: number;
}

interface ChannelFormState {
  name: string;
  type: NotificationChannelType;
  url: string;
  secret: string;
  enabled: boolean;
  clearSecret: boolean;
}

const TYPE_LABELS: Record<NotificationChannelType, string> = {
  dingtalk: "钉钉",
  feishu: "飞书",
  webhook: "Webhook",
};

const TYPE_VARIANTS: Record<
  NotificationChannelType,
  "default" | "secondary" | "outline"
> = {
  dingtalk: "default",
  feishu: "secondary",
  webhook: "outline",
};

const EMPTY_FORM: ChannelFormState = {
  name: "",
  type: "dingtalk",
  url: "",
  secret: "",
  enabled: true,
  clearSecret: false,
};

// ============ Helpers ============

function formatSendResult(result: ChannelView["lastSendResult"]): {
  label: string;
  tone: "success" | "error" | "muted";
} {
  if (!result) return { label: "尚未发送", tone: "muted" };
  const time = new Date(result.timestamp).toLocaleString("zh-CN");
  if (result.success) return { label: `成功 · ${time}`, tone: "success" };
  return {
    label: `失败 · ${time}${result.error ? ` · ${result.error}` : ""}`,
    tone: "error",
  };
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + "…";
}

// ============ Page ============

export default function NotificationsPage() {
  const [config, setConfig] = useState<NotificationsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [testFlash, setTestFlash] = useState<
    Record<string, { success: boolean; message: string }>
  >({});

  const [thresholdInput, setThresholdInput] = useState("");
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdDirty, setThresholdDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NotificationsConfig = await res.json();
      setConfig(data);
      setThresholdInput(String(data.defaultLowBalanceThreshold));
      setThresholdDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- Channel CRUD ----------

  const openAddDialog = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (channel: ChannelView) => {
    setEditingId(channel.id);
    setForm({
      name: channel.name,
      type: channel.type,
      url: channel.url,
      secret: "",
      enabled: channel.enabled,
      clearSecret: false,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError("请填写渠道名称");
      return;
    }
    if (!form.url.trim()) {
      setFormError("请填写 webhook URL");
      return;
    }
    try {
      new URL(form.url.trim());
    } catch {
      setFormError("webhook URL 格式不正确");
      return;
    }

    setFormSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        url: form.url.trim(),
        enabled: form.enabled,
      };
      if (editingId) {
        // On edit, only touch secret when the user typed a new one or asked to
        // clear it. Sending `null` clears, sending a string replaces.
        if (form.clearSecret) {
          body.secret = null;
        } else if (form.secret.length > 0) {
          body.secret = form.secret;
        }
        const res = await fetch(`/api/notifications/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      } else {
        if (form.secret.length > 0) body.secret = form.secret;
        const res = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async (channel: ChannelView) => {
    if (!window.confirm(`确定要删除渠道「${channel.name}」吗？`)) return;
    try {
      const res = await fetch(`/api/notifications/${channel.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (channel: ChannelView) => {
    try {
      const res = await fetch(`/api/notifications/${channel.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async (channel: ChannelView) => {
    setTestingIds((prev) => new Set(prev).add(channel.id));
    setTestFlash((prev) => {
      const next = { ...prev };
      delete next[channel.id];
      return next;
    });
    try {
      const res = await fetch(`/api/notifications/${channel.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setTestFlash((prev) => ({
          ...prev,
          [channel.id]: {
            success: false,
            message: data.error || `HTTP ${res.status}`,
          },
        }));
      } else {
        setTestFlash((prev) => ({
          ...prev,
          [channel.id]: { success: true, message: "测试消息已发送" },
        }));
      }
      await load();
    } catch (err) {
      setTestFlash((prev) => ({
        ...prev,
        [channel.id]: {
          success: false,
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(channel.id);
        return next;
      });
    }
  };

  // ---------- Threshold ----------

  const saveThreshold = async () => {
    const value = Number(thresholdInput);
    if (!isFinite(value) || value < 0) {
      setError("阈值必须是非负数字");
      return;
    }
    setThresholdSaving(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultLowBalanceThreshold: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setThresholdDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThresholdSaving(false);
    }
  };

  // ---------- Derived ----------

  const dialogTitle = editingId ? "编辑渠道" : "添加渠道";
  const editingChannel = useMemo(
    () => config?.channels.find((c) => c.id === editingId) ?? null,
    [config, editingId]
  );

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center h-[400px] text-muted-foreground">
          加载中...
        </div>
      </div>
    );
  }

  if (!config) {
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
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="outline" size="icon" aria-label="返回">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2">
                <Bell className="h-6 w-6" />
                通知设置
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                管理通知渠道与全局默认低余额阈值
              </p>
            </div>
          </div>
          <Button onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-2" />
            添加渠道
          </Button>
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

        {/* Global threshold */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">全局默认低余额阈值</CardTitle>
            <CardDescription>
              一次性订阅未单独设置阈值时使用此值。修改后对未自定义阈值的订阅立即生效。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 max-w-xs">
              <div className="flex-1 space-y-1">
                <Label htmlFor="threshold">阈值</Label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  step="0.01"
                  value={thresholdInput}
                  onChange={(e) => {
                    setThresholdInput(e.target.value);
                    setThresholdDirty(true);
                  }}
                />
              </div>
              <Button
                onClick={saveThreshold}
                disabled={thresholdSaving || !thresholdDirty}
              >
                {thresholdSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    保存中
                  </>
                ) : (
                  "保存"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Channel list */}
        <div>
          <h2 className="text-xl font-semibold mb-4">通知渠道</h2>
          {config.channels.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                暂无渠道。点击「添加渠道」开始配置通知。
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {config.channels.map((channel) => {
                const sendInfo = formatSendResult(channel.lastSendResult);
                const isTesting = testingIds.has(channel.id);
                const flash = testFlash[channel.id];
                return (
                  <Card key={channel.id}>
                    <CardContent className="py-4 flex flex-col md:flex-row md:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">
                            {channel.name}
                          </span>
                          <Badge variant={TYPE_VARIANTS[channel.type]}>
                            {TYPE_LABELS[channel.type]}
                          </Badge>
                          <Badge
                            variant={channel.enabled ? "success" : "secondary"}
                          >
                            {channel.enabled ? "已启用" : "已禁用"}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 truncate">
                          {truncateUrl(channel.url)}
                          {channel.hasSecret && (
                            <span className="ml-2 text-xs">
                              · 🔒 已配置签名
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-1 flex items-center gap-1.5">
                          {sendInfo.tone === "success" && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                          )}
                          {sendInfo.tone === "error" && (
                            <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                          )}
                          <span
                            className={
                              sendInfo.tone === "muted"
                                ? "text-muted-foreground"
                                : sendInfo.tone === "success"
                                  ? "text-green-700 dark:text-green-400"
                                  : "text-red-700 dark:text-red-400"
                            }
                          >
                            {sendInfo.label}
                          </span>
                        </div>
                        {flash && (
                          <div
                            className={`text-xs mt-1 flex items-center gap-1.5 ${
                              flash.success
                                ? "text-green-700 dark:text-green-400"
                                : "text-red-700 dark:text-red-400"
                            }`}
                          >
                            {flash.success ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                            <span>{flash.message}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTest(channel)}
                          disabled={isTesting || !channel.enabled}
                          title={
                            channel.enabled
                              ? "发送一条测试消息"
                              : "请先启用渠道"
                          }
                        >
                          {isTesting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              发送中
                            </>
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-1" />
                              测试发送
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleToggle(channel)}
                          title={channel.enabled ? "禁用" : "启用"}
                        >
                          <Power className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => openEditDialog(channel)}
                          title="编辑"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleDelete(channel)}
                          title="删除"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Add/Edit dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? "修改渠道配置。签名留空表示保持不变，勾选「清除」以移除。"
                  : "添加一个新的通知渠道（钉钉 / 飞书 / 通用 webhook）。"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitForm} className="flex flex-col gap-4">
              <div className="space-y-1">
                <Label htmlFor="ch-name">名称</Label>
                <Input
                  id="ch-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：值班钉钉群"
                  maxLength={100}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="ch-type">类型</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm({ ...form, type: v as NotificationChannelType })
                  }
                >
                  <SelectTrigger id="ch-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dingtalk">钉钉</SelectItem>
                    <SelectItem value="feishu">飞书</SelectItem>
                    <SelectItem value="webhook">通用 Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ch-url">Webhook URL</Label>
                <Input
                  id="ch-url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="ch-secret">加签 Secret（可选）</Label>
                <Input
                  id="ch-secret"
                  type="password"
                  value={form.secret}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })}
                  placeholder={
                    editingChannel?.hasSecret
                      ? "••••••••（留空保持不变）"
                      : "选填，用于 HMAC 加签"
                  }
                />
                {editingChannel?.hasSecret && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <input
                      type="checkbox"
                      checked={form.clearSecret}
                      onChange={(e) =>
                        setForm({ ...form, clearSecret: e.target.checked })
                      }
                      className="accent-primary"
                    />
                    清除已配置的签名
                  </label>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                  className="accent-primary"
                />
                启用此渠道
              </label>

              {formError && (
                <div className="text-sm text-destructive flex items-center gap-1.5">
                  <XCircle className="h-4 w-4" />
                  {formError}
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={formSubmitting}
                >
                  取消
                </Button>
                <Button type="submit" disabled={formSubmitting}>
                  {formSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      保存中
                    </>
                  ) : (
                    "保存"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
