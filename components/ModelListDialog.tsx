"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { ModelsResult } from "@/lib/types";

interface ModelListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  cachedModels?: string[] | null;
  onModelsUpdate?: (models: string[]) => void;
  cachedUpdatedAt?: Date | null;
  onUpdatedAtChange?: (date: Date) => void;
}

export function ModelListDialog({
  open,
  onOpenChange,
  subscriptionId,
  cachedModels = null,
  onModelsUpdate,
  cachedUpdatedAt = null,
  onUpdatedAtChange,
}: ModelListDialogProps) {
  const [models, setModels] = useState<string[] | null>(cachedModels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(
    cachedUpdatedAt
  );

  // Sync with cache from parent
  useEffect(() => {
    if (cachedModels !== undefined) {
      setModels(cachedModels);
    }
  }, [cachedModels]);

  useEffect(() => {
    if (cachedUpdatedAt !== undefined) {
      setLastUpdatedAt(cachedUpdatedAt);
    }
  }, [cachedUpdatedAt]);

  const fetchModels = async (forceRefresh = false) => {
    // If we have cached models and not forcing refresh, skip fetch
    if (models && !forceRefresh) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}/models`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "查询失败");
      }

      const data: ModelsResult = await res.json();
      setModels(data.models);
      const now = new Date();
      setLastUpdatedAt(now);

      // Update parent cache
      onModelsUpdate?.(data.models);
      onUpdatedAtChange?.(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : "查询失败";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch if dialog is open and we don't have models yet
    if (open && models === null && !loading) {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, models]);

  const filteredModels = models
    ? models.filter((model) =>
        model.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const formatUpdateTime = (date: Date): string => {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>模型列表</DialogTitle>
          <DialogDescription>
            当前订阅可用的模型列表（会话内缓存）
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索模型..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              disabled={!models}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchModels(true)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            刷新
          </Button>
        </div>

        {lastUpdatedAt && (
          <div className="text-xs text-muted-foreground mb-2">
            更新于 {formatUpdateTime(lastUpdatedAt)}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && !models ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              加载中...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <p className="mb-2">查询失败</p>
              <p className="text-sm">{error}</p>
            </div>
          ) : models && models.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              未查询到模型
            </div>
          ) : filteredModels.length === 0 && searchQuery ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              未找到匹配的模型
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                共 {models?.length || 0} 个模型
                {searchQuery &&
                  filteredModels.length !== models?.length &&
                  ` · 显示 ${filteredModels.length} 个`}
              </div>
              <div className="space-y-1">
                {filteredModels.map((model) => (
                  <div
                    key={model}
                    className="text-sm font-mono px-3 py-2 rounded-md bg-muted/50 break-all"
                  >
                    {model}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
