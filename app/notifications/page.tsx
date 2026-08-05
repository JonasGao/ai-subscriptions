"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Users,
  Phone,
  MessageSquare,
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
import { FeishuPermissionsChecklist } from "@/components/FeishuPermissionsChecklist";
import type {
  NotificationChannel,
  NotificationChannelType,
  FeishuReceiveIdType,
} from "@/lib/types";
import { findPermissionByScope } from "@/lib/notifications/feishu-permissions";

// ============ Types ============

type ChannelView = Omit<NotificationChannel, "secret" | "appSecret"> & {
  hasSecret: boolean;
  hasAppSecret: boolean;
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
  // Feishu-app fields
  appId: string;
  appSecret: string;
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
  clearAppSecret: boolean;
}

const TYPE_LABELS: Record<NotificationChannelType, string> = {
  dingtalk: "钉钉",
  feishu: "飞书",
  webhook: "Webhook",
  "feishu-app": "飞书应用",
};

const TYPE_VARIANTS: Record<
  NotificationChannelType,
  "default" | "secondary" | "outline"
> = {
  dingtalk: "default",
  feishu: "secondary",
  webhook: "outline",
  "feishu-app": "secondary",
};

const EMPTY_FORM: ChannelFormState = {
  name: "",
  type: "dingtalk",
  url: "",
  secret: "",
  enabled: true,
  clearSecret: false,
  appId: "",
  appSecret: "",
  receiveId: "",
  receiveIdType: "open_id",
  clearAppSecret: false,
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

  // ---------- Feishu helper states ----------
  type HelperMode = "none" | "chats" | "phone" | "listen";
  const [helperMode, setHelperMode] = useState<HelperMode>("none");

  // Chat list helper
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [chatsResult, setChatsResult] = useState<{
    items: Array<{ chat_id: string; name: string }>;
    has_more: boolean;
    page_token?: string;
  } | null>(null);
  const [chatsLoadingMore, setChatsLoadingMore] = useState(false);

  // Phone lookup helper
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneResult, setPhoneResult] = useState<Array<{
    open_id: string;
    mobile?: string;
    name?: string;
  }> | null>(null);

  // Listen helper
  const [listenLoading, setListenLoading] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenActive, setListenActive] = useState(false);
  /** Snapshot listenId from start response - used for poll/stop instead of form appId */
  const [listenId, setListenId] = useState<string | null>(null);
  /** TTL from server response (seconds) */
  const [listenTtlSeconds, setListenTtlSeconds] = useState<number | null>(null);
  const [listenMessages, setListenMessages] = useState<
    Array<{
      open_id: string;
      name?: string;
      message_id: string;
      receivedAt: string;
    }>
  >([]);
  const listenPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    resetHelpers();
    setDialogOpen(true);
  };

  const openEditDialog = (channel: ChannelView) => {
    setEditingId(channel.id);
    setForm({
      name: channel.name,
      type: channel.type,
      url: channel.url ?? "",
      secret: "",
      enabled: channel.enabled,
      clearSecret: false,
      appId: channel.appId ?? "",
      appSecret: "",
      receiveId: channel.receiveId ?? "",
      receiveIdType: channel.receiveIdType ?? "open_id",
      clearAppSecret: false,
    });
    setFormError(null);
    resetHelpers();
    setDialogOpen(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError("请填写渠道名称");
      return;
    }

    const isFeishuApp = form.type === "feishu-app";

    // Validate based on channel type
    if (isFeishuApp) {
      if (!form.appId.trim()) {
        setFormError("请填写 App ID");
        return;
      }
      if (!editingId && !form.appSecret.trim()) {
        setFormError("请填写 App Secret");
        return;
      }
      if (!form.receiveId.trim()) {
        setFormError("请填写 Receive ID");
        return;
      }
      if (
        form.receiveIdType !== "open_id" &&
        form.receiveIdType !== "chat_id"
      ) {
        setFormError("Receive ID 类型必须是 open_id 或 chat_id");
        return;
      }
    } else {
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
    }

    setFormSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        enabled: form.enabled,
      };

      if (isFeishuApp) {
        body.appId = form.appId.trim();
        body.receiveId = form.receiveId.trim();
        body.receiveIdType = form.receiveIdType;
      } else {
        body.url = form.url.trim();
      }

      if (editingId) {
        // On edit, only touch secret/appSecret when the user typed a new one
        // or asked to clear it. Sending `null` clears, sending a string replaces.
        if (!isFeishuApp) {
          if (form.clearSecret) {
            body.secret = null;
          } else if (form.secret.length > 0) {
            body.secret = form.secret;
          }
        } else {
          if (form.clearAppSecret) {
            body.appSecret = null;
          } else if (form.appSecret.length > 0) {
            body.appSecret = form.appSecret;
          }
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
        if (!isFeishuApp) {
          if (form.secret.length > 0) body.secret = form.secret;
        } else {
          if (form.appSecret.length > 0) body.appSecret = form.appSecret;
        }
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

  // ---------- Feishu helpers ----------

  /** Whether we have credentials available (either direct or via hasSecret). */
  const hasCredentials = useMemo(() => {
    if (form.type !== "feishu-app") return false;
    if (form.appId.trim() && form.appSecret.trim()) return true;
    // Editing mode: hasSecret means we can use stored appSecret
    if (editingId && editingChannel?.hasAppSecret && form.appId.trim())
      return true;
    return false;
  }, [form.appId, form.appSecret, form.type, editingId, editingChannel]);

  /** Builds the body for helper API calls (direct creds or channelId). */
  const buildHelperBody = useCallback(
    (extra: Record<string, unknown>): Record<string, unknown> => {
      const body: Record<string, unknown> = { ...extra };
      if (form.appId.trim()) body.appId = form.appId.trim();
      if (form.appSecret.trim()) {
        body.appSecret = form.appSecret.trim();
      } else if (editingId && editingChannel?.hasAppSecret) {
        body.channelId = editingId;
      }
      return body;
    },
    [form.appId, form.appSecret, editingId, editingChannel]
  );

  /** Resets all helper states when dialog opens/closes. */
  const resetHelpers = useCallback(() => {
    setHelperMode("none");
    setChatsLoading(false);
    setChatsError(null);
    setChatsResult(null);
    setChatsLoadingMore(false);
    setPhoneInput("");
    setPhoneLoading(false);
    setPhoneError(null);
    setPhoneResult(null);
    setListenLoading(false);
    setListenError(null);
    setListenActive(false);
    setListenId(null);
    setListenTtlSeconds(null);
    setListenMessages([]);
    if (listenPollRef.current) {
      clearInterval(listenPollRef.current);
      listenPollRef.current = null;
    }
  }, []);

  // Stop listener polling when dialog closes or helper mode changes
  useEffect(() => {
    if (!dialogOpen) {
      resetHelpers();
    }
  }, [dialogOpen, resetHelpers]);

  // Stop listener on unmount
  useEffect(() => {
    return () => {
      if (listenPollRef.current) {
        clearInterval(listenPollRef.current);
      }
    };
  }, []);

  const stopListenerPolling = useCallback(async () => {
    if (listenPollRef.current) {
      clearInterval(listenPollRef.current);
      listenPollRef.current = null;
    }
    setListenActive(false);
    // Best-effort stop on server using the snapshot listenId (not current form appId)
    if (listenId) {
      try {
        await fetch(
          `/api/notifications/feishu-app/listen?listenId=${encodeURIComponent(
            listenId
          )}`,
          { method: "DELETE" }
        );
      } catch {
        // Ignore errors
      }
    }
    setListenId(null);
  }, [listenId]);

  const handleFetchChats = useCallback(async () => {
    setHelperMode("chats");
    setChatsLoading(true);
    setChatsError(null);
    setChatsResult(null);
    try {
      const res = await fetch("/api/notifications/feishu-app/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildHelperBody({})),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setChatsResult(data);
    } catch (err) {
      setChatsError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatsLoading(false);
    }
  }, [buildHelperBody]);

  const handleLoadMoreChats = useCallback(async () => {
    if (!chatsResult?.has_more || !chatsResult?.page_token) return;
    setChatsLoadingMore(true);
    setChatsError(null);
    try {
      const res = await fetch("/api/notifications/feishu-app/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildHelperBody({ page_token: chatsResult.page_token })
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Append new items to existing list
      setChatsResult((prev) =>
        prev
          ? {
              ...data,
              items: [...prev.items, ...(data.items ?? [])],
            }
          : data
      );
    } catch (err) {
      setChatsError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatsLoadingMore(false);
    }
  }, [buildHelperBody, chatsResult]);

  const handleSelectChat = useCallback(
    (chatId: string, chatName: string) => {
      setForm({ ...form, receiveId: chatId, receiveIdType: "chat_id" });
      setHelperMode("none");
    },
    [form, setForm]
  );

  const handleLookupPhone = useCallback(async () => {
    const phone = phoneInput.trim();
    if (!phone) {
      setPhoneError("请输入手机号");
      return;
    }
    setHelperMode("phone");
    setPhoneLoading(true);
    setPhoneError(null);
    setPhoneResult(null);
    try {
      const res = await fetch("/api/notifications/feishu-app/lookup-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildHelperBody({ mobiles: [phone] })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const userList = (data.user_list ?? []).map(
        (u: { user_id?: { open_id?: string }; mobile?: string }) => ({
          open_id: u.user_id?.open_id ?? "",
          mobile: u.mobile,
        })
      );
      setPhoneResult(userList);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhoneLoading(false);
    }
  }, [phoneInput, buildHelperBody]);

  const handleSelectPhoneUser = useCallback(
    (openId: string) => {
      setForm({ ...form, receiveId: openId, receiveIdType: "open_id" });
      setHelperMode("none");
    },
    [form, setForm]
  );

  const handleStartListen = useCallback(async () => {
    setHelperMode("listen");
    setListenLoading(true);
    setListenError(null);
    setListenMessages([]);
    setListenId(null);
    setListenTtlSeconds(null);
    try {
      const res = await fetch("/api/notifications/feishu-app/listen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildHelperBody({})),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const serverListenId = data.listenId as string | undefined;
      const serverTtlSeconds = data.ttlSeconds as number | undefined;
      setListenActive(true);
      if (serverListenId) setListenId(serverListenId);
      if (serverTtlSeconds !== undefined) setListenTtlSeconds(serverTtlSeconds);

      // Start polling using the snapshot listenId (not current form appId)
      const idForPoll = serverListenId;
      if (!idForPoll) return;

      listenPollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(
            `/api/notifications/feishu-app/listen?listenId=${encodeURIComponent(
              idForPoll
            )}`
          );
          // 404 = listener gone (tombstone expired or never existed) — stop polling
          if (pollRes.status === 404) {
            if (listenPollRef.current) {
              clearInterval(listenPollRef.current);
              listenPollRef.current = null;
            }
            setListenActive(false);
            setListenId(null);
            return;
          }
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();
          // Tombstone: stopped=true means listener auto-stopped (timeout/manual/error)
          if (pollData.status?.stopped) {
            if (listenPollRef.current) {
              clearInterval(listenPollRef.current);
              listenPollRef.current = null;
            }
            setListenActive(false);
            setListenId(null);
            // Still update messages one last time before stopping
          }
          const messages = pollData.messages ?? [];
          setListenMessages(
            messages.map(
              (m: {
                sender?: { open_id?: string; name?: string };
                message?: { message_id?: string };
                receivedAt?: string;
              }) => ({
                open_id: m.sender?.open_id ?? "",
                name: m.sender?.name,
                message_id: m.message?.message_id ?? "",
                receivedAt: m.receivedAt ?? "",
              })
            )
          );
        } catch {
          // Ignore poll errors
        }
      }, 2000);
    } catch (err) {
      setListenError(err instanceof Error ? err.message : String(err));
    } finally {
      setListenLoading(false);
    }
  }, [buildHelperBody]);

  const handleStopListen = useCallback(async () => {
    await stopListenerPolling();
  }, [stopListenerPolling]);

  const handleSelectListenUser = useCallback(
    (openId: string) => {
      setForm({ ...form, receiveId: openId, receiveIdType: "open_id" });
      stopListenerPolling();
      setHelperMode("none");
    },
    [form, setForm, stopListenerPolling]
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
                          {channel.type === "feishu-app" ? (
                            <>
                              <span>App ID: {channel.appId ?? "-"}</span>
                              <span className="mx-1">·</span>
                              <span>
                                {channel.receiveIdType === "open_id"
                                  ? "单聊"
                                  : "群聊"}
                                : {channel.receiveId ?? "-"}
                              </span>
                              {channel.hasAppSecret && (
                                <span className="ml-2 text-xs">
                                  · 🔒 已配置 App Secret
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {truncateUrl(channel.url ?? "")}
                              {channel.hasSecret && (
                                <span className="ml-2 text-xs">
                                  · 🔒 已配置签名
                                </span>
                              )}
                            </>
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
                  ? "修改渠道配置。密钥留空表示保持不变，勾选「清除」以移除。"
                  : "添加一个新的通知渠道（钉钉 / 飞书 / 飞书应用 / 通用 webhook）。"}
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
                    <SelectItem value="feishu">飞书群机器人</SelectItem>
                    <SelectItem value="feishu-app">飞书应用机器人</SelectItem>
                    <SelectItem value="webhook">通用 Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.type === "feishu-app" ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="ch-appId">App ID</Label>
                    <Input
                      id="ch-appId"
                      value={form.appId}
                      onChange={(e) =>
                        setForm({ ...form, appId: e.target.value })
                      }
                      placeholder="飞书应用 App ID"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ch-appSecret">App Secret</Label>
                    <Input
                      id="ch-appSecret"
                      type="password"
                      value={form.appSecret}
                      onChange={(e) =>
                        setForm({ ...form, appSecret: e.target.value })
                      }
                      placeholder={
                        editingChannel?.hasAppSecret
                          ? "••••••••（留空保持不变）"
                          : "飞书应用 App Secret"
                      }
                    />
                    {editingChannel?.hasAppSecret && (
                      <label className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <input
                          type="checkbox"
                          checked={form.clearAppSecret}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              clearAppSecret: e.target.checked,
                            })
                          }
                          className="accent-primary"
                        />
                        清除已配置的 App Secret
                      </label>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ch-receiveIdType">接收类型</Label>
                    <Select
                      value={form.receiveIdType}
                      onValueChange={(v) =>
                        setForm({
                          ...form,
                          receiveIdType: v as FeishuReceiveIdType,
                        })
                      }
                    >
                      <SelectTrigger id="ch-receiveIdType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open_id">单聊 (open_id)</SelectItem>
                        <SelectItem value="chat_id">群聊 (chat_id)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ch-receiveId">Receive ID</Label>
                    <Input
                      id="ch-receiveId"
                      value={form.receiveId}
                      onChange={(e) =>
                        setForm({ ...form, receiveId: e.target.value })
                      }
                      placeholder={
                        form.receiveIdType === "open_id"
                          ? "用户 open_id"
                          : "群组 chat_id"
                      }
                    />
                  </div>

                  {/* ============ Feishu permissions checklist ============ */}
                  <FeishuPermissionsChecklist appId={form.appId} />
                  {/* ============ End feishu permissions checklist ============ */}

                  {/* ============ Feishu helper section ============ */}
                  <div className="rounded-md border border-dashed border-muted-foreground/30 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span>辅助获取 Receive ID</span>
                      {!hasCredentials && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          (请先填写 App ID 和 App Secret)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!hasCredentials || chatsLoading}
                        onClick={handleFetchChats}
                        title={
                          hasCredentials
                            ? "列出机器人所在的群,选择后填入 chat_id"
                            : "请先填写 App ID 和 App Secret"
                        }
                      >
                        {chatsLoading ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            加载中
                          </>
                        ) : (
                          <>
                            <Users className="h-3.5 w-3.5 mr-1" />
                            从群列表选择
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!hasCredentials}
                        onClick={() => {
                          setHelperMode("phone");
                          setPhoneResult(null);
                          setPhoneError(null);
                        }}
                        title={
                          hasCredentials
                            ? "输入手机号查询 open_id"
                            : "请先填写 App ID 和 App Secret"
                        }
                      >
                        <Phone className="h-3.5 w-3.5 mr-1" />
                        手机号查询
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!hasCredentials || listenLoading}
                        onClick={
                          listenActive ? handleStopListen : handleStartListen
                        }
                        title={
                          hasCredentials
                            ? listenActive
                              ? "停止监听"
                              : "建立长连接,通过接收消息获取 open_id"
                            : "请先填写 App ID 和 App Secret"
                        }
                      >
                        {listenLoading ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            连接中
                          </>
                        ) : listenActive ? (
                          <>
                            <MessageSquare className="h-3.5 w-3.5 mr-1" />
                            停止监听
                          </>
                        ) : (
                          <>
                            <MessageSquare className="h-3.5 w-3.5 mr-1" />
                            通过消息获取
                          </>
                        )}
                      </Button>
                      {helperMode !== "none" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (listenActive) {
                              stopListenerPolling();
                            }
                            setHelperMode("none");
                          }}
                        >
                          关闭
                        </Button>
                      )}
                    </div>

                    {/* Chat list results */}
                    {helperMode === "chats" && (
                      <div className="space-y-2">
                        {chatsError && (
                          <div className="text-sm text-destructive flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5" />
                            {chatsError}
                          </div>
                        )}
                        {chatsResult && (
                          <div className="space-y-1">
                            {chatsResult.items.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                机器人不在任何群中。请先将机器人添加到群聊。
                              </p>
                            ) : (
                              <>
                                <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                                  {chatsResult.items.map((chat) => (
                                    <button
                                      key={chat.chat_id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                      onClick={() =>
                                        handleSelectChat(
                                          chat.chat_id,
                                          chat.name
                                        )
                                      }
                                    >
                                      <div className="font-medium">
                                        {chat.name || "(未命名群)"}
                                      </div>
                                      <div className="text-xs text-muted-foreground font-mono">
                                        {chat.chat_id}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                                {chatsResult.has_more && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={chatsLoadingMore}
                                    onClick={handleLoadMoreChats}
                                    className="w-full"
                                  >
                                    {chatsLoadingMore ? (
                                      <>
                                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                        加载中
                                      </>
                                    ) : (
                                      "加载更多群..."
                                    )}
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Phone lookup */}
                    {helperMode === "phone" && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            placeholder="+8613800138000"
                            value={phoneInput}
                            onChange={(e) => setPhoneInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleLookupPhone();
                              }
                            }}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={phoneLoading}
                            onClick={handleLookupPhone}
                          >
                            {phoneLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "查询"
                            )}
                          </Button>
                        </div>
                        {phoneError && (
                          <div className="text-sm text-destructive flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5" />
                            {phoneError}
                          </div>
                        )}
                        {phoneResult && (
                          <div className="space-y-1">
                            {phoneResult.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                未找到匹配的用户。请检查手机号是否正确,并确保已开通
                                <code className="mx-1 text-[11px] font-mono bg-muted px-1 rounded">
                                  {findPermissionByScope(
                                    "contact:user.id:readonly"
                                  )?.scope ?? "contact:user.id:readonly"}
                                </code>
                                权限。
                              </p>
                            ) : (
                              <div className="rounded-md border border-border divide-y divide-border">
                                {phoneResult.map((user) => (
                                  <button
                                    key={user.open_id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                    onClick={() =>
                                      handleSelectPhoneUser(user.open_id)
                                    }
                                  >
                                    <div className="font-medium">
                                      {user.name || user.mobile || "未知用户"}
                                    </div>
                                    <div className="text-xs text-muted-foreground font-mono">
                                      open_id: {user.open_id}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Listen results */}
                    {helperMode === "listen" && (
                      <div className="space-y-2">
                        {listenError && (
                          <div className="text-sm text-destructive flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5" />
                            {listenError}
                          </div>
                        )}
                        {listenActive && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400" />
                            <span>
                              正在监听...请给机器人发送任意消息(
                              {listenTtlSeconds !== null
                                ? `${Math.round(listenTtlSeconds / 60)}分钟`
                                : "2分钟"}
                              后自动停止)
                            </span>
                          </div>
                        )}
                        {listenMessages.length > 0 && (
                          <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                            {listenMessages.map((msg, idx) => (
                              <button
                                key={`${msg.message_id}-${idx}`}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                onClick={() =>
                                  handleSelectListenUser(msg.open_id)
                                }
                              >
                                <div className="font-medium">
                                  {msg.name || "未知用户"}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  open_id: {msg.open_id}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(msg.receivedAt).toLocaleTimeString(
                                    "zh-CN"
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {!listenActive &&
                          listenMessages.length === 0 &&
                          !listenError && (
                            <p className="text-sm text-muted-foreground">
                              监听已停止。点击「通过消息获取」重新启动。
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                  {/* ============ End feishu helper section ============ */}
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="ch-url">Webhook URL</Label>
                    <Input
                      id="ch-url"
                      value={form.url}
                      onChange={(e) =>
                        setForm({ ...form, url: e.target.value })
                      }
                      placeholder="https://..."
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ch-secret">加签 Secret（可选）</Label>
                    <Input
                      id="ch-secret"
                      type="password"
                      value={form.secret}
                      onChange={(e) =>
                        setForm({ ...form, secret: e.target.value })
                      }
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
                            setForm({
                              ...form,
                              clearSecret: e.target.checked,
                            })
                          }
                          className="accent-primary"
                        />
                        清除已配置的签名
                      </label>
                    )}
                  </div>
                </>
              )}

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
