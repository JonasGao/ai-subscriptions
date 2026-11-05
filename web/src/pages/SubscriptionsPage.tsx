import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { CloseIcon, DragIcon } from "../components/icons.tsx";
import { createStore, reconcile } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../auth/AuthProvider";
import { MainPageShell } from "../components/MainPageShell";
import { StatsCards } from "../components/StatsCards";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { SubscriptionForm } from "../components/SubscriptionForm";
import { TimetableHeader } from "../components/TimetableHeader";
import { createNow } from "../lib/useNow";
import { priorityScenes } from "../priorities/api";
import { PriorityScenes } from "../priorities/PriorityScenes";
import { SortablePriorityList } from "../priorities/SortablePriorityList";
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import {
  createSubscription,
  deleteSubscription,
  fetchCategories,
  fetchProviders,
  fetchSubscriptions,
  fetchTags,
  reorderSubscriptions,
  toggleScheduleExhausted,
  updateSubscription,
} from "../subscriptions/api";
import type {
  Provider,
  Subscription,
  SubscriptionFormData,
  SubscriptionStatus,
  Tag,
} from "../subscriptions/types";

const SELECTED_CATEGORY_KEY = "selectedCategory";
const SELECTED_STATUSES_KEY = "selectedStatuses";

const STATUS_OPTIONS: Array<{ value: SubscriptionStatus; label: string }> = [
  { value: "active", label: "活跃" },
  { value: "paused", label: "暂停" },
  { value: "cancelled", label: "已取消" },
];

/** readStoredFilter restores a filter exactly like the old list page did. */
function readStoredCategory(): string {
  try {
    return window.localStorage?.getItem(SELECTED_CATEGORY_KEY) || "all";
  } catch {
    return "all";
  }
}

function readStoredStatuses(): SubscriptionStatus[] {
  try {
    const raw = window.localStorage?.getItem(SELECTED_STATUSES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is SubscriptionStatus =>
      STATUS_OPTIONS.some((option) => option.value === value)
    );
  } catch {
    return [];
  }
}

/**
 * SubscriptionsPage is the real list page: it renders the API's subscriptions
 * through SubscriptionCard, and owns create/edit/pause/delete. The auth shell
 * (session gate, logout) stays here until the page-shell ticket (#40).
 */
export const SubscriptionsPage: Component = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  // A store (not a signal) keeps list updates identity-stable: reconcile
  // merges by id in place, so replacing a subscription never remounts its card
  // and re-fires the mount query (#34). A plain signal array would.
  const [subscriptions, setSubscriptions] = createStore<Subscription[]>([]);
  const [categories, setCategories] = createSignal<string[]>([]);
  const [tags, setTags] = createSignal<Tag[]>([]);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Subscription | null>(null);
  const [selectedCategory, setSelectedCategory] =
    createSignal(readStoredCategory());
  const [selectedStatuses, setSelectedStatuses] =
    createSignal<SubscriptionStatus[]>(readStoredStatuses());
  const now = createNow();

  const loadData = async () => {
    try {
      setLoading(true);
      // Providers load together with the subscriptions: the cards decide their
      // query affordances from the catalog, so it must be present on first
      // render (and the card auto-query fires from it).
      const [subs, cats, catalog, providerCatalog] = await Promise.all([
        fetchSubscriptions(),
        fetchCategories(),
        fetchTags(),
        fetchProviders().catch(() => [] as Provider[]),
      ]);
      setSubscriptions(reconcile(subs, { key: "id" }));
      setCategories(cats);
      setTags(catalog);
      setProviders(providerCatalog);
    } catch {
      setErrorMessage("加载订阅失败，请刷新页面");
    } finally {
      setLoading(false);
    }
  };

  onMount(loadData);

  const refreshTags = async (): Promise<boolean> => {
    try {
      setTags(await fetchTags());
      return true;
    } catch {
      return false;
    }
  };

  const visibleSubscriptions = () =>
    subscriptions
      .filter((subscription) => {
        const categoryMatch =
          selectedCategory() === "all" ||
          subscription.category === selectedCategory();
        const statusMatch =
          selectedStatuses().length === 0 ||
          selectedStatuses().includes(subscription.status);
        return categoryMatch && statusMatch;
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    try {
      window.localStorage?.setItem(SELECTED_CATEGORY_KEY, category);
    } catch {
      // Private mode / storage disabled: filtering still works for this visit.
    }
  };

  const toggleStatus = (status: SubscriptionStatus) => {
    const next = selectedStatuses().includes(status)
      ? selectedStatuses().filter((value) => value !== status)
      : [...selectedStatuses(), status];
    setSelectedStatuses(next);
    try {
      window.localStorage?.setItem(SELECTED_STATUSES_KEY, JSON.stringify(next));
    } catch {
      // See handleCategoryChange.
    }
  };

  const handleLogout = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (subscription: Subscription) => {
    setEditing(subscription);
    setFormOpen(true);
  };

  const handleSubmit = async (data: SubscriptionFormData): Promise<boolean> => {
    setErrorMessage(null);
    try {
      if (editing()) {
        const updated = await updateSubscription(editing()!.id, data);
        setSubscriptions(
          reconcile(
            subscriptions.map((item) =>
              item.id === updated.id ? updated : item
            ),
            { key: "id" }
          )
        );
      } else {
        const created = await createSubscription(data);
        setSubscriptions(reconcile([...subscriptions, created], { key: "id" }));
        if (!categories().includes(created.category)) {
          setCategories((previous) => [...previous, created.category]);
        }
      }
      if (!(await refreshTags())) {
        setErrorMessage("订阅已保存，但标签列表刷新失败，请刷新页面");
      }
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
      return false;
    }
  };

  const handleStatusChange = async (
    id: string,
    status: "active" | "paused"
  ) => {
    const original = subscriptions.find((item) => item.id === id);
    if (!original) return;

    setSubscriptions(
      reconcile(
        subscriptions.map((item) =>
          item.id === id ? { ...item, status } : item
        ),
        { key: "id" }
      )
    );

    try {
      await updateSubscription(id, { status });
    } catch {
      setSubscriptions(
        reconcile(
          subscriptions.map((item) => (item.id === id ? original : item)),
          { key: "id" }
        )
      );
      setErrorMessage("状态切换失败，请重试");
    }
  };

  // Server-calibrated subscription echoed back by the usage query route
  // (ADR-0016, #34): merge it into the list in place so the card and its edit
  // form show the calibrated schedule without a refetch or a card remount.
  const handleSubscriptionUpdate = (updated: Subscription) => {
    setSubscriptions(
      reconcile(
        subscriptions.map((item) => (item.id === updated.id ? updated : item)),
        { key: "id" }
      )
    );
  };

  const handleScheduleToggle = async (
    id: string,
    scheduleId: string,
    exhausted: boolean
  ) => {
    try {
      const updated = await toggleScheduleExhausted(id, scheduleId, exhausted);
      setSubscriptions(
        reconcile(
          subscriptions.map((item) =>
            item.id === updated.id ? updated : item
          ),
          { key: "id" }
        )
      );
    } catch {
      setErrorMessage("重置计划切换失败，请重试");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSubscription(id);
      setSubscriptions(
        reconcile(
          subscriptions.filter((item) => item.id !== id),
          { key: "id" }
        )
      );
    } catch {
      setErrorMessage("删除订阅失败，请重试");
    }
  };

  const handleReorder = async (event: DragEvent) => {
    const { draggable, droppable } = event;
    if (!droppable || draggable.id === droppable.id) return;

    const sorted = visibleSubscriptions();
    const from = sorted.findIndex((sub) => sub.id === String(draggable.id));
    const to = sorted.findIndex((sub) => sub.id === String(droppable.id));
    if (from === -1 || to === -1) return;

    const reordered = [...sorted];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const newOrder = reordered.map((sub) => sub.id);

    try {
      const updated = await reorderSubscriptions(newOrder);
      setSubscriptions(reconcile(updated, { key: "id" }));
    } catch {
      setErrorMessage("拖拽排序失败，请重试");
    }
  };

  return (
    <MainPageShell activePage="subscriptions">
      <main class="subscriptions-page">
        <header class="subscriptions-header">
          <p class="tagline">已登录：{auth.session()?.user.name ?? ""}</p>
          <div class="subscriptions-toolbar">
            <button type="button" onClick={openCreate}>
              添加订阅
            </button>
            <button type="button" class="ghost" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        </header>

        <Show when={errorMessage()}>
          <div class="error-banner" role="alert">
            <span>{errorMessage()}</span>
            <button
              type="button"
              class="ghost"
              aria-label="关闭错误提示"
              onClick={() => setErrorMessage(null)}
            >
              <CloseIcon />
            </button>
          </div>
        </Show>

        <Show when={!loading()} fallback={<p class="loading">加载中...</p>}>
          <StatsCards subscriptions={visibleSubscriptions()} />

          <section class="filter-bar" aria-label="筛选">
            <label class="category-filter">
              <span>分类</span>
              <select
                aria-label="分类筛选"
                value={selectedCategory()}
                onChange={(event) =>
                  handleCategoryChange(event.currentTarget.value)
                }
              >
                <option value="all">全部分类</option>
                <For each={categories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
            </label>
            <fieldset class="status-filter">
              <legend>状态筛选</legend>
              <For each={STATUS_OPTIONS}>
                {(option) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedStatuses().includes(option.value)}
                      onChange={() => toggleStatus(option.value)}
                    />
                    {option.label}
                  </label>
                )}
              </For>
            </fieldset>
          </section>

          <Show
            when={visibleSubscriptions().length > 0}
            fallback={
              <p class="empty-state">还没有订阅，点击「添加订阅」开始记录。</p>
            }
          >
            <DragDropProvider
              collisionDetector={closestCenter}
              onDragEnd={handleReorder}
            >
              <DragDropSensors />
              <SortableProvider
                ids={visibleSubscriptions().map((sub) => sub.id)}
              >
                <TimetableHeader now={now()} />
                <section class="subscription-list">
                  <For each={visibleSubscriptions()}>
                    {(subscription) => (
                      <SubscriptionCard
                        subscription={subscription}
                        tags={tags()}
                        providers={providers()}
                        onEdit={openEdit}
                        onDelete={handleDelete}
                        onStatusChange={handleStatusChange}
                        onSubscriptionUpdate={handleSubscriptionUpdate}
                        onScheduleToggle={handleScheduleToggle}
                      />
                    )}
                  </For>
                </section>
              </SortableProvider>
            </DragDropProvider>
          </Show>
        </Show>

        <section class="priority-section">
          <h2>优先级管理</h2>
          <PriorityScenes
            client={priorityScenes}
            orderOf={(scene) => scene.subscriptionOrder}
            items={subscriptions.map((subscription) => ({
              id: subscription.id,
              name: subscription.name,
            }))}
            addLabel="订阅"
            emptyLabel="该场景暂无订阅，请从下方列表添加"
            renderList={(order, onRemove) => (
              <SortablePriorityList
                subscriptionOrder={order}
                subscriptions={subscriptions}
                onRemove={onRemove}
              />
            )}
          />
        </section>

        <Show when={formOpen()}>
          <SubscriptionForm
            open={formOpen()}
            onOpenChange={setFormOpen}
            subscription={editing()}
            categories={categories()}
            tags={tags()}
            providers={providers()}
            onSubmit={handleSubmit}
          />
        </Show>
      </main>
    </MainPageShell>
  );
};
