"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
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
import { Subscription, Tag } from "@/lib/types";
import { getTagNameError, normalizeTagName } from "@/lib/tags";

interface TagManagerDialogProps {
  tags: Tag[];
  subscriptions: Subscription[];
  onRename: (tagId: string, name: string) => Promise<Tag>;
  onDelete: (tagId: string) => Promise<void>;
}

export function TagManagerDialog({
  tags,
  subscriptions,
  onRename,
  onDelete,
}: TagManagerDialogProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const subscription of subscriptions) {
      for (const tagId of subscription.tagIds ?? []) {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      }
    }
    return counts;
  }, [subscriptions]);

  const visibleTags = tags.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );

  const saveRename = async (tag: Tag) => {
    const name = normalizeTagName(editingName);
    const validationError = getTagNameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (tags.some((item) => item.id !== tag.id && item.name === name)) {
      setError("标签名称已存在");
      return;
    }

    setBusyId(tag.id);
    setError(null);
    try {
      await onRename(tag.id, name);
      setEditingId(null);
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : "重命名失败"
      );
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async (tag: Tag) => {
    setBusyId(tag.id);
    setError(null);
    try {
      await onDelete(tag.id);
      setPendingDelete(null);
      if (editingId === tag.id) setEditingId(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "删除标签失败"
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        onClick={() => setOpen(true)}
        title="管理标签"
        aria-label="管理标签"
      >
        <Settings2 className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>管理标签</DialogTitle>
            <DialogDescription>重命名或彻底删除历史标签。</DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="搜索标签"
              autoComplete="off"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="max-h-[48vh] space-y-1 overflow-y-auto pr-1">
            {visibleTags.map((tag) => {
              const usageCount = usageCounts.get(tag.id) ?? 0;
              const isBusy = busyId === tag.id;
              return (
                <div
                  key={tag.id}
                  className="flex min-h-11 items-center gap-2 border-b px-1 py-2 last:border-0"
                >
                  {editingId === tag.id ? (
                    <Input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveRename(tag);
                        }
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 flex-1"
                      autoFocus
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium">
                        {tag.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {usageCount > 0
                          ? `${usageCount} 个订阅使用`
                          : "暂未使用"}
                      </p>
                    </div>
                  )}

                  {isBusy ? (
                    <Loader2 className="mx-3 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : editingId === tag.id ? (
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
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (usageCount > 0) {
                            setPendingDelete(tag);
                          } else {
                            void runDelete(tag);
                          }
                        }}
                        title={`删除 ${tag.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}

            {visibleTags.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {tags.length === 0 ? "还没有历史标签" : "没有匹配的标签"}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>彻底删除标签</DialogTitle>
            <DialogDescription>
              标签“{pendingDelete?.name}”正在被
              {pendingDelete ? (usageCounts.get(pendingDelete.id) ?? 0) : 0}
              个订阅使用。删除后会同时解除这些关联，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!pendingDelete || busyId === pendingDelete.id}
              onClick={() => pendingDelete && void runDelete(pendingDelete)}
            >
              {pendingDelete && busyId === pendingDelete.id && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
