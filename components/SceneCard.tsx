"use client";

import { Plus, Trash2, Edit2, Check, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ReactNode, useState } from "react";

interface ItemInfo {
  id: string;
  name: string;
}

interface SceneCardProps {
  sceneId: string;
  sceneName: string;
  isEditing: boolean;
  editingName: string;
  items: ItemInfo[];
  availableItems: ItemInfo[];
  hasItems: boolean;
  emptyLabel: string;
  addLabel: string;
  sortableList: ReactNode;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onRename: () => void;
  onEditingNameChange: (name: string) => void;
  onAddItems: (itemIds: string[]) => void;
}

export function SceneCard({
  sceneName,
  isEditing,
  editingName,
  availableItems,
  hasItems,
  emptyLabel,
  addLabel,
  sortableList,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onRename,
  onEditingNameChange,
  onAddItems,
}: SceneCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredItems = availableItems.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const toggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        {isEditing ? (
          <div className="flex gap-2 flex-1">
            <Input
              value={editingName}
              onChange={(e) => onEditingNameChange(e.target.value)}
              placeholder="场景名称"
              className="flex-1"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onCancelEdit();
              }}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <CardTitle className="text-lg font-medium">{sceneName}</CardTitle>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEdit();
                }}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        {hasItems ? (
          <div className="space-y-2 flex-1">{sortableList}</div>
        ) : (
          <div className="text-sm text-muted-foreground py-2 flex-1">
            {emptyLabel}
          </div>
        )}

        <div className="mt-3">
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setSearch("");
                setSelectedIds([]);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={availableItems.length === 0}
              >
                <Plus className="h-4 w-4 mr-1" />
                添加{addLabel}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>添加{addLabel}</DialogTitle>
              </DialogHeader>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`搜索${addLabel}名称`}
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {filteredItems.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <Button
                      key={item.id}
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => toggleItem(item.id)}
                    >
                      {isSelected ? (
                        <Check className="h-3 w-3 mr-1 shrink-0" />
                      ) : (
                        <Plus className="h-3 w-3 mr-1 shrink-0" />
                      )}
                      <span className="truncate">{item.name}</span>
                    </Button>
                  );
                })}
                {filteredItems.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    没有可添加的{addLabel}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  className="w-full"
                  disabled={selectedIds.length === 0}
                  onClick={() => {
                    onAddItems(selectedIds);
                    setDialogOpen(false);
                    setSearch("");
                    setSelectedIds([]);
                  }}
                >
                  <Check className="h-4 w-4 mr-1" />
                  确定（{selectedIds.length}）
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
