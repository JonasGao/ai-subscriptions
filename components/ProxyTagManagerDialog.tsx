"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Search, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProxySubscription, ProxySubscriptionTag } from "@/lib/types";
import { getTagNameError, normalizeTagName } from "@/lib/tags";

interface Props {
  tags: ProxySubscriptionTag[];
  subscriptions: ProxySubscription[];
  onRename: (id: string, name: string) => Promise<ProxySubscriptionTag>;
  onDelete: (id: string) => Promise<void>;
}

export function ProxyTagManagerDialog({
  tags,
  subscriptions,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] =
    useState<ProxySubscriptionTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    subscriptions.forEach((subscription) =>
      (subscription.tagIds ?? []).forEach((id) =>
        result.set(id, (result.get(id) ?? 0) + 1)
      )
    );
    return result;
  }, [subscriptions]);
  const visibleTags = tags.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );

  const saveRename = async (tag: ProxySubscriptionTag) => {
    const name = normalizeTagName(editingName);
    const validationError = getTagNameError(name);
    if (validationError) return setError(validationError);
    if (tags.some((item) => item.id !== tag.id && item.name === name))
      return setError("标签名称已存在");
    try {
      await onRename(tag.id, name);
      setEditingId(null);
      setError(null);
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : "重命名失败"
      );
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
      setError(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "删除标签失败"
      );
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title="管理代理标签"
        aria-label="管理代理标签"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>管理代理标签</DialogTitle>
            <DialogDescription>重命名或删除代理订阅标签。</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标签"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="max-h-[48vh] space-y-1 overflow-y-auto pr-1">
            {visibleTags.map((tag) => (
              <div
                key={tag.id}
                className="flex min-h-11 items-center gap-2 border-b px-1 py-2 last:border-0"
              >
                {editingId === tag.id ? (
                  <Input
                    className="h-8 flex-1"
                    autoFocus
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveRename(tag);
                      }
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium">{tag.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {counts.get(tag.id) ?? 0} 个代理订阅使用
                    </p>
                  </div>
                )}
                {editingId === tag.id ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => void saveRename(tag)}
                      title="保存名称"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditingId(null)}
                      title="取消重命名"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingId(tag.id);
                        setEditingName(tag.name);
                        setError(null);
                      }}
                      title={`重命名 ${tag.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setPendingDelete(tag)}
                      title={`删除 ${tag.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {!visibleTags.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                暂无代理标签
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(value) => !value && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除代理标签？</DialogTitle>
            <DialogDescription>
              删除后会从所有代理订阅中移除该标签。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
