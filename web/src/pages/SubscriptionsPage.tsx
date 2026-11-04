import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../auth/AuthProvider";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { SubscriptionForm } from "../components/SubscriptionForm";
import {
  createSubscription,
  deleteSubscription,
  fetchCategories,
  fetchProviders,
  fetchSubscriptions,
  fetchTags,
  updateSubscription,
} from "../subscriptions/api";
import type {
  Provider,
  Subscription,
  SubscriptionFormData,
  Tag,
} from "../subscriptions/types";

/**
 * SubscriptionsPage is the real list page: it renders the API's subscriptions
 * through SubscriptionCard, and owns create/edit/pause/delete. The auth shell
 * (session gate, logout) stays here until the page-shell ticket (#40).
 */
export const SubscriptionsPage: Component = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  const [subscriptions, setSubscriptions] = createSignal<Subscription[]>([]);
  const [categories, setCategories] = createSignal<string[]>([]);
  const [tags, setTags] = createSignal<Tag[]>([]);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Subscription | null>(null);
  const [selectedCategory, setSelectedCategory] = createSignal("all");

  const loadData = async () => {
    try {
      setLoading(true);
      const [subs, cats, catalog] = await Promise.all([
        fetchSubscriptions(),
        fetchCategories(),
        fetchTags(),
      ]);
      setSubscriptions(subs);
      setCategories(cats);
      setTags(catalog);
    } catch {
      setErrorMessage("加载订阅失败，请刷新页面");
    } finally {
      setLoading(false);
    }
    try {
      setProviders(await fetchProviders());
    } catch {
      // Provider names are cosmetic; the id still renders.
      setProviders([]);
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
    subscriptions().filter(
      (subscription) =>
        selectedCategory() === "all" ||
        subscription.category === selectedCategory()
    );

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
        setSubscriptions((previous) =>
          previous.map((item) => (item.id === updated.id ? updated : item))
        );
      } else {
        const created = await createSubscription(data);
        setSubscriptions((previous) => [...previous, created]);
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

  const handleStatusChange = async (id: string, status: "active" | "paused") => {
    const original = subscriptions().find((item) => item.id === id);
    if (!original) return;

    setSubscriptions((previous) =>
      previous.map((item) => (item.id === id ? { ...item, status } : item))
    );

    try {
      await updateSubscription(id, { status });
    } catch {
      setSubscriptions((previous) =>
        previous.map((item) => (item.id === id ? original : item))
      );
      setErrorMessage("状态切换失败，请重试");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSubscription(id);
      setSubscriptions((previous) =>
        previous.filter((item) => item.id !== id)
      );
    } catch {
      setErrorMessage("删除订阅失败，请重试");
    }
  };

  return (
    <main class="subscriptions-page">
      <header class="subscriptions-header">
        <div>
          <h1>AI订阅管理</h1>
          <p class="tagline">已登录：{auth.session()?.user.name ?? ""}</p>
        </div>
        <div class="subscriptions-toolbar">
          <label class="category-filter">
            <span>分类</span>
            <select
              value={selectedCategory()}
              onChange={(event) => setSelectedCategory(event.currentTarget.value)}
            >
              <option value="all">全部</option>
              <For each={categories()}>
                {(category) => <option value={category}>{category}</option>}
              </For>
            </select>
          </label>
          <button type="button" onClick={openCreate}>
            添加订阅
          </button>
          <button type="button" class="ghost" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </header>

      <Show when={errorMessage()}>
        <p class="form-error" role="alert">
          {errorMessage()}
        </p>
      </Show>

      <Show when={!loading()} fallback={<p class="loading">加载中...</p>}>
        <Show
          when={visibleSubscriptions().length > 0}
          fallback={<p class="empty-state">还没有订阅，点击「添加订阅」开始记录。</p>}
        >
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
                />
              )}
            </For>
          </section>
        </Show>
      </Show>

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
  );
};
