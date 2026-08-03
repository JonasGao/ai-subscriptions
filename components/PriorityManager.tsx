"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Check, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PriorityScene, Subscription } from "@/lib/types";
import { SortablePriorityList } from "@/components/SortablePriorityList";
import { SceneCard } from "@/components/SceneCard";
import { usePriorityScenes } from "@/hooks/usePriorityScenes";

interface PriorityManagerProps {
  subscriptions: Subscription[];
}

export function PriorityManager({ subscriptions }: PriorityManagerProps) {
  const {
    scenes,
    isCreating,
    editingSceneId,
    editingSceneName,
    newSceneName,
    loading,
    setIsCreating,
    setEditingSceneId,
    setEditingSceneName,
    setNewSceneName,
    handleCreateScene,
    handleDeleteScene,
    handleRenameScene,
    handleDragEnd,
    handleRemoveItem,
    handleAddItems,
  } = usePriorityScenes<PriorityScene>({
    apiPath: "/api/priorities",
    orderField: "subscriptionOrder",
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getAvailableSubscriptions = (sceneId: string) => {
    const scene = scenes.find((s) => s.id === sceneId);
    return subscriptions.filter(
      (s) => !scene?.subscriptionOrder.includes(s.id)
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">加载中...</div>
        </CardContent>
      </Card>
    );
  }

  if (scenes.length === 0 && !isCreating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            优先级管理
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              创建场景
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4">
            暂无场景，点击上方按钮创建新场景
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isCreating && (
        <Card className="border-primary">
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input
                value={newSceneName}
                onChange={(e) => setNewSceneName(e.target.value)}
                placeholder="场景名称"
                className="flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleCreateScene}>
                <Check className="h-4 w-4 mr-1" />
                创建
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(false);
                  setNewSceneName("");
                }}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {scenes.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-stretch">
          {scenes.map((scene) => {
            const isEditing = editingSceneId === scene.id;
            const availableSubs = getAvailableSubscriptions(scene.id);

            return (
              <SceneCard
                key={scene.id}
                sceneId={scene.id}
                sceneName={scene.name}
                isEditing={isEditing}
                editingName={editingSceneName}
                items={subscriptions.filter((s) =>
                  scene.subscriptionOrder.includes(s.id)
                )}
                availableItems={availableSubs}
                hasItems={scene.subscriptionOrder.length > 0}
                emptyLabel="暂无订阅，点击下方添加"
                addLabel="订阅"
                onStartEdit={() => {
                  setEditingSceneId(scene.id);
                  setEditingSceneName(scene.name);
                }}
                onCancelEdit={() => {
                  setEditingSceneId("");
                  setEditingSceneName("");
                }}
                onDelete={() => handleDeleteScene(scene.id)}
                onRename={handleRenameScene}
                onEditingNameChange={setEditingSceneName}
                onAddItems={(ids) => handleAddItems(ids, scene.id)}
                sortableList={
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(e, scene.id)}
                  >
                    <SortableContext
                      items={scene.subscriptionOrder}
                      strategy={verticalListSortingStrategy}
                    >
                      <SortablePriorityList
                        subscriptionOrder={scene.subscriptionOrder}
                        subscriptions={subscriptions}
                        onRemove={(id) => handleRemoveItem(id, scene.id)}
                      />
                    </SortableContext>
                  </DndContext>
                }
              />
            );
          })}
        </div>
      )}

      {!isCreating && scenes.length > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setIsCreating(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          创建新场景
        </Button>
      )}
    </div>
  );
}
