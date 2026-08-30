"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "@/components/TagInput";
import { ProxyTagManagerDialog } from "@/components/ProxyTagManagerDialog";
import {
  calculateProxyExpirationDate,
  getProxyDateNotice,
  getProxyTodayDate,
  isDateOnly,
} from "@/lib/proxy-utils";
import {
  ProxySubscription,
  ProxySubscriptionFormData,
  ProxySubscriptionStatus,
  ProxySubscriptionTag,
} from "@/lib/types";

type SortKey = "date" | "expiration" | "price" | "name";
const statusLabels: Record<ProxySubscriptionStatus, string> = {
  unused: "未使用",
  "in-use": "正在使用",
  expired: "已过期",
};
const statusVariants: Record<
  ProxySubscriptionStatus,
  "secondary" | "success" | "destructive"
> = { unused: "secondary", "in-use": "success", expired: "destructive" };

function today() {
  return getProxyTodayDate();
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
function money(value: number) {
  return `¥${value.toFixed(2)}`;
}

function ProxySubscriptionForm({
  open,
  onOpenChange,
  subscription,
  tags,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: ProxySubscription | null;
  tags: ProxySubscriptionTag[];
  onSubmit: (data: ProxySubscriptionFormData) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("0");
  const [expirationDate, setExpirationDate] = useState("");
  const [hasExpiration, setHasExpiration] = useState(true);
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ProxySubscriptionStatus>("unused");
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [dateMode, setDateMode] = useState<"expiration" | "duration">(
    "duration"
  );
  const [startDate, setStartDate] = useState(today);
  const [durationDays, setDurationDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (subscription) {
      setName(subscription.name);
      setMonthlyPrice(String(subscription.monthlyPrice));
      setExpirationDate(subscription.expirationDate ?? "");
      setHasExpiration(!!subscription.expirationDate);
      setWebsite(subscription.website ?? "");
      setNotes(subscription.notes ?? "");
      setStatus(subscription.status);
      setTagNames(
        (subscription.tagIds ?? [])
          .map((id) => tags.find((tag) => tag.id === id)?.name)
          .filter((name): name is string => !!name)
      );
      setDateMode("expiration");
      setStartDate(today());
      setDurationDays("");
    } else {
      setName("");
      setMonthlyPrice("0");
      setExpirationDate("");
      setHasExpiration(true);
      setWebsite("");
      setNotes("");
      setStatus("unused");
      setTagNames([]);
      setDateMode("duration");
      setStartDate(today());
      setDurationDays("");
    }
    setError(null);
  }, [open, subscription, tags]);

  const calculatedExpiration =
    dateMode === "duration" &&
    isDateOnly(startDate) &&
    /^\d+$/.test(durationDays) &&
    Number(durationDays) > 0
      ? calculateProxyExpirationDate(startDate, Number(durationDays))
      : "";
  const effectiveExpiration = hasExpiration
    ? dateMode === "duration"
      ? calculatedExpiration
      : expirationDate
    : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError("请输入代理订阅名称");
    if (!Number.isFinite(Number(monthlyPrice)) || Number(monthlyPrice) < 0)
      return setError("请输入有效的单月价格");
    if (hasExpiration && !effectiveExpiration)
      return setError(
        dateMode === "duration" ? "请输入有效的订阅天数" : "请输入到期日期"
      );
    setSubmitting(true);
    try {
      const ok = await onSubmit({
        name: name.trim(),
        monthlyPrice: Number(monthlyPrice),
        expirationDate: effectiveExpiration ?? "",
        website: website.trim() || undefined,
        notes: notes || undefined,
        status,
        tagNames,
      });
      if (ok) onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>
            {subscription ? "编辑代理订阅" : "添加代理订阅"}
          </DialogTitle>
          <DialogDescription>
            记录代理服务的价格、到期日期和使用状态。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="proxy-name">名字</Label>
              <Input
                id="proxy-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxy-price">单月价格（元）</Label>
              <Input
                id="proxy-price"
                type="number"
                min="0"
                step="0.01"
                value={monthlyPrice}
                onChange={(event) => setMonthlyPrice(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxy-status">状态</Label>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as ProxySubscriptionStatus)
                }
              >
                <SelectTrigger id="proxy-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unused">未使用</SelectItem>
                  <SelectItem value="in-use">正在使用</SelectItem>
                  <SelectItem value="expired">已过期</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3">
            <Label>有效期</Label>
            <RadioGroup
              value={hasExpiration ? "dated" : "unlimited"}
              onValueChange={(value) => setHasExpiration(value === "dated")}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="dated" id="proxy-has-expiration" />
                <Label htmlFor="proxy-has-expiration">设置到期日期</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="unlimited" id="proxy-unlimited" />
                <Label htmlFor="proxy-unlimited">无限期（按流量）</Label>
              </div>
            </RadioGroup>
            {hasExpiration && (
              <>
                <Label>到期日期输入方式</Label>
                <RadioGroup
                  value={dateMode}
                  onValueChange={(value) => {
                    const nextMode = value as typeof dateMode;
                    setDateMode(nextMode);
                    if (nextMode === "duration") {
                      setStartDate(today());
                      setDurationDays("");
                    }
                  }}
                  className="flex flex-wrap gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="duration" id="proxy-duration" />
                    <Label htmlFor="proxy-duration">起始日期 + 可用天数</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="expiration" id="proxy-expiration" />
                    <Label htmlFor="proxy-expiration">直接输入到期日期</Label>
                  </div>
                </RadioGroup>
                {dateMode === "duration" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="proxy-start">起始日期</Label>
                      <Input
                        id="proxy-start"
                        type="date"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="proxy-days">可用天数</Label>
                      <Input
                        id="proxy-days"
                        type="number"
                        min="1"
                        step="1"
                        value={durationDays}
                        onChange={(event) =>
                          setDurationDays(event.target.value)
                        }
                        placeholder="例如 30"
                      />
                      {calculatedExpiration && (
                        <p className="text-xs text-muted-foreground">
                          到期日期：{formatDate(calculatedExpiration)}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="proxy-expiration-date">到期日期</Label>
                    <Input
                      id="proxy-expiration-date"
                      type="date"
                      value={expirationDate}
                      onChange={(event) =>
                        setExpirationDate(event.target.value)
                      }
                      required
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label>标签</Label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <TagInput tags={tags} value={tagNames} onChange={setTagNames} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-website">网站地址</Label>
            <Input
              id="proxy-website"
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-notes">备注</Label>
            <textarea
              id="proxy-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={4}
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProxySubscriptionCard({
  subscription,
  tags,
  onEdit,
  onDelete,
}: {
  subscription: ProxySubscription;
  tags: ProxySubscriptionTag[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const notice = getProxyDateNotice(subscription);
  const subscriptionTags = (subscription.tagIds ?? [])
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is ProxySubscriptionTag => !!tag);
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="break-words text-lg">
            {subscription.name}
          </CardTitle>
          <Badge variant={statusVariants[subscription.status]}>
            {statusLabels[subscription.status]}
          </Badge>
        </div>
        {subscriptionTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {subscriptionTags.map((tag) => (
              <Badge key={tag.id} variant="outline">
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">单月价格</span>
          <span className="font-medium">
            {money(subscription.monthlyPrice)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">到期日期</span>
          <span>
            {subscription.expirationDate
              ? formatDate(subscription.expirationDate)
              : "无限期"}
          </span>
        </div>
        {notice.kind === "remaining" && (
          <p className="text-xs text-emerald-600">剩余 {notice.days} 天</p>
        )}
        {notice.kind === "today" && (
          <p className="text-xs text-amber-600">今天到期</p>
        )}
        {notice.kind === "overdue" && (
          <p className="text-xs text-destructive">已逾期 {notice.days} 天</p>
        )}
        {subscription.website && (
          <a
            href={subscription.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 break-all text-primary hover:underline"
          >
            <Globe2 className="h-3.5 w-3.5 shrink-0" />
            {subscription.website}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        )}
        {subscription.notes && (
          <div>
            <span className="text-muted-foreground">备注</span>
            <p className="mt-1 whitespace-pre-wrap break-words">
              {subscription.notes}
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 pt-0">
        <Button
          variant="ghost"
          size="icon"
          title="编辑代理订阅"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="删除代理订阅"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </CardFooter>
    </Card>
  );
}

export function ProxySubscriptionTab() {
  const [subscriptions, setSubscriptions] = useState<ProxySubscription[]>([]);
  const [tags, setTags] = useState<ProxySubscriptionTag[]>([]);
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProxySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [subscriptionsResponse, tagsResponse] = await Promise.all([
        fetch("/api/proxy-subscriptions"),
        fetch("/api/proxy-tags"),
      ]);
      if (!subscriptionsResponse.ok || !tagsResponse.ok)
        throw new Error("加载代理订阅失败");
      setSubscriptions(await subscriptionsResponse.json());
      setTags(await tagsResponse.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const storedStatus = localStorage.getItem("proxySelectedStatus");
    if (storedStatus) setSelectedStatus(storedStatus);
    void load();
  }, []);
  const filtered = useMemo(
    () =>
      subscriptions
        .filter(
          (item) => selectedStatus === "all" || item.status === selectedStatus
        )
        .sort((a, b) =>
          sortKey === "name"
            ? a.name.localeCompare(b.name)
            : sortKey === "price"
              ? b.monthlyPrice - a.monthlyPrice
              : sortKey === "expiration"
                ? (b.expirationDate ?? "").localeCompare(a.expirationDate ?? "")
                : b.createdAt.localeCompare(a.createdAt)
        ),
    [subscriptions, selectedStatus, sortKey]
  );
  const totalPrice = filtered.reduce((sum, item) => sum + item.monthlyPrice, 0);

  const submit = async (data: ProxySubscriptionFormData) => {
    setError(null);
    const response = await fetch(
      editing
        ? `/api/proxy-subscriptions/${editing.id}`
        : "/api/proxy-subscriptions",
      {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "保存失败");
      return false;
    }
    setSubscriptions((items) =>
      editing
        ? items.map((item) => (item.id === result.id ? result : item))
        : [...items, result]
    );
    await loadTags();
    return true;
  };
  const loadTags = async () => {
    const response = await fetch("/api/proxy-tags");
    if (response.ok) setTags(await response.json());
  };
  const deleteSubscription = async (id: string) => {
    if (!window.confirm("确定删除这个代理订阅吗？")) return;
    const response = await fetch(`/api/proxy-subscriptions/${id}`, {
      method: "DELETE",
    });
    if (response.ok)
      setSubscriptions((items) => items.filter((item) => item.id !== id));
  };
  const renameTag = async (id: string, name: string) => {
    const response = await fetch(`/api/proxy-tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setTags((items) => items.map((item) => (item.id === id ? result : item)));
    return result;
  };
  const deleteTag = async (id: string) => {
    const response = await fetch(`/api/proxy-tags/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setTags((items) => items.filter((item) => item.id !== id));
    setSubscriptions((items) =>
      items.map((item) => ({
        ...item,
        tagIds: (item.tagIds ?? []).filter((tagId) => tagId !== id),
      }))
    );
  };

  if (loading)
    return (
      <div className="flex h-60 items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">代理订阅</h2>
          <p className="text-sm text-muted-foreground">
            共 {filtered.length} 条 · 月价合计 {money(totalPrice)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProxyTagManagerDialog
            tags={tags}
            subscriptions={subscriptions}
            onRename={renameTag}
            onDelete={deleteTag}
          />
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            添加代理订阅
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="proxy-status-filter">状态</Label>
          <Select
            value={selectedStatus}
            onValueChange={(value) => {
              setSelectedStatus(value);
              localStorage.setItem("proxySelectedStatus", value);
            }}
          >
            <SelectTrigger id="proxy-status-filter" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="unused">未使用</SelectItem>
              <SelectItem value="in-use">正在使用</SelectItem>
              <SelectItem value="expired">已过期</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="proxy-sort">排序</Label>
          <Select
            value={sortKey}
            onValueChange={(value) => setSortKey(value as SortKey)}
          >
            <SelectTrigger id="proxy-sort" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">录入时间（新到旧）</SelectItem>
              <SelectItem value="expiration">到期日期（晚到早）</SelectItem>
              <SelectItem value="price">月价（高到低）</SelectItem>
              <SelectItem value="name">名称（A-Z）</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          暂无代理订阅
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((subscription) => (
            <ProxySubscriptionCard
              key={subscription.id}
              subscription={subscription}
              tags={tags}
              onEdit={() => {
                setEditing(subscription);
                setFormOpen(true);
              }}
              onDelete={() => void deleteSubscription(subscription.id)}
            />
          ))}
        </div>
      )}
      <ProxySubscriptionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        subscription={editing}
        tags={tags}
        onSubmit={submit}
      />
    </div>
  );
}
