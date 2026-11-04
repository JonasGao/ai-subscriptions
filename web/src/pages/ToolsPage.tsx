// ToolsPage (#35): the managed-tool catalog and the tool priority scenes,
// ported from app/tools/page.tsx + components/ToolTab.tsx.

import { Show, createSignal, onMount, type Component } from "solid-js";
import { fetchCategories, fetchProviders } from "../subscriptions/api";
import type { Provider } from "../subscriptions/types";
import {
  createTool,
  deleteTool,
  listTools,
  reorderTools,
  toolPriorityScenes,
  updateTool,
} from "../priorities/api";
import type { Tool, ToolFormData } from "../priorities/types";
import { PriorityScenes } from "../priorities/PriorityScenes";
import { SortableToolPriorityList } from "../priorities/SortableToolPriorityList";
import { ToolForm } from "../tools/ToolForm";
import { ToolList } from "../tools/ToolList";

export const ToolsPage: Component = () => {
  const [tools, setTools] = createSignal<Tool[]>([]);
  const [categories, setCategories] = createSignal<string[]>([]);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Tool | null>(null);

  const message = (value: unknown, fallback: string) =>
    value instanceof Error ? value.message : fallback;

  onMount(async () => {
    try {
      const [toolList, categoryList] = await Promise.all([
        listTools(),
        fetchCategories(),
      ]);
      setTools(toolList);
      setCategories(categoryList);
    } catch (loadError) {
      setError(message(loadError, "加载工具失败，请刷新页面"));
    } finally {
      setLoading(false);
    }
    try {
      setProviders(await fetchProviders());
    } catch {
      setProviders([]);
    }
  });

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (tool: Tool) => {
    setEditing(tool);
    setFormOpen(true);
  };

  const handleSubmit = async (data: ToolFormData): Promise<boolean> => {
    setError(null);
    try {
      if (editing()) {
        const updated = await updateTool(editing()!.id, data);
        setTools((previous) =>
          previous.map((tool) => (tool.id === updated.id ? updated : tool))
        );
      } else {
        const created = await createTool(data);
        setTools((previous) => [...previous, created]);
        if (!categories().includes(created.category)) {
          setCategories((previous) => [...previous, created.category]);
        }
      }
      return true;
    } catch (submitError) {
      setError(message(submitError, "保存失败"));
      return false;
    }
  };

  const handleDelete = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("确定要删除该工具吗？")) {
      return;
    }
    setError(null);
    try {
      await deleteTool(id);
      setTools((previous) => previous.filter((tool) => tool.id !== id));
    } catch (deleteError) {
      setError(message(deleteError, "删除工具失败"));
    }
  };

  const handleStatusChange = async (id: string, status: Tool["status"]) => {
    const original = tools().find((tool) => tool.id === id);
    if (!original) return;
    setTools((previous) =>
      previous.map((tool) => (tool.id === id ? { ...tool, status } : tool))
    );
    try {
      const updated = await updateTool(id, { status });
      setTools((previous) =>
        previous.map((tool) => (tool.id === updated.id ? updated : tool))
      );
    } catch {
      setTools((previous) =>
        previous.map((tool) => (tool.id === id ? original : tool))
      );
      setError("状态切换失败，请重试");
    }
  };

  const handleReorder = async (toolIds: string[]) => {
    try {
      setTools(await reorderTools(toolIds));
    } catch (reorderError) {
      setError(message(reorderError, "保存工具排序失败"));
    }
  };

  return (
    <main class="tools-page">
      <nav class="shell-nav">
        <a href="/subscriptions">AI 订阅</a>
        <a href="/proxy-subscriptions">代理订阅</a>
        <a href="/tools">工具</a>
      </nav>

      <header class="tools-header">
        <h1>工具管理</h1>
        <button type="button" onClick={openCreate}>
          添加工具
        </button>
      </header>

      <Show when={error()}>
        <p class="form-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!loading()} fallback={<p class="loading">加载中...</p>}>
        <ToolList
          tools={tools()}
          onEdit={openEdit}
          onDelete={(id) => void handleDelete(id)}
          onStatusChange={(id, status) => void handleStatusChange(id, status)}
          onReorder={(ids) => void handleReorder(ids)}
        />
      </Show>

      <section class="priority-section">
        <h2>工具优先级管理</h2>
        <PriorityScenes
          client={toolPriorityScenes}
          orderOf={(scene) => scene.toolOrder}
          items={tools().map((tool) => ({ id: tool.id, name: tool.name }))}
          addLabel="工具"
          emptyLabel="该场景暂无工具，请从下方列表添加"
          renderList={(order, onRemove) => (
            <SortableToolPriorityList
              toolOrder={order}
              tools={tools()}
              onRemove={onRemove}
            />
          )}
        />
      </section>

      <ToolForm
        open={formOpen()}
        onOpenChange={setFormOpen}
        tool={editing()}
        categories={categories()}
        providers={providers()}
        onSubmit={handleSubmit}
      />
    </main>
  );
};
