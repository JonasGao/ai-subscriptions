import { createSignal, onMount, type Component } from "solid-js";
import { MainPageShell } from "../components/MainPageShell";
import {
  createProxySubscription,
  deleteProxySubscription,
  deleteProxyTag,
  listProxySubscriptions,
  listProxyTags,
  renameProxyTag,
  updateProxySubscription,
  type ProxySubscription,
  type ProxySubscriptionFormData,
  type ProxySubscriptionTag,
} from "../proxy/api";
import { ProxySubscriptionTab } from "../proxy/ProxySubscriptionTab";

// ProxySubscriptionsPage is the SolidJS port of app/proxy-subscriptions/page.tsx:
// the route owns data loading and mutation, the tab renders it.

const SELECTED_STATUS_KEY = "proxySelectedStatus";

export const ProxySubscriptionsPage: Component = () => {
  const [subscriptions, setSubscriptions] = createSignal<ProxySubscription[]>([]);
  const [tags, setTags] = createSignal<ProxySubscriptionTag[]>([]);
  const [selectedStatus, setSelectedStatus] = createSignal("all");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const message = (value: unknown) =>
    value instanceof Error ? value.message : "加载失败";

  const loadTags = async () => {
    try {
      setTags(await listProxyTags());
    } catch (tagError) {
      setError(message(tagError));
    }
  };

  onMount(async () => {
    const stored = window.localStorage?.getItem(SELECTED_STATUS_KEY);
    if (stored) setSelectedStatus(stored);
    try {
      const [loadedSubscriptions, loadedTags] = await Promise.all([
        listProxySubscriptions(),
        listProxyTags(),
      ]);
      setSubscriptions(loadedSubscriptions);
      setTags(loadedTags);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  });

  const selectStatus = (value: string) => {
    setSelectedStatus(value);
    window.localStorage?.setItem(SELECTED_STATUS_KEY, value);
  };

  const create = async (data: ProxySubscriptionFormData) => {
    setError(null);
    try {
      const created = await createProxySubscription(data);
      setSubscriptions((items) => [...items, created]);
      await loadTags();
      return true;
    } catch (createError) {
      setError(message(createError));
      return false;
    }
  };

  const update = async (id: string, data: ProxySubscriptionFormData) => {
    setError(null);
    try {
      const updated = await updateProxySubscription(id, data);
      setSubscriptions((items) =>
        items.map((item) => (item.id === updated.id ? updated : item))
      );
      await loadTags();
      return true;
    } catch (updateError) {
      setError(message(updateError));
      return false;
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteProxySubscription(id);
      setSubscriptions((items) => items.filter((item) => item.id !== id));
    } catch (deleteError) {
      setError(message(deleteError));
    }
  };

  const renameTag = async (id: string, name: string) => {
    const renamed = await renameProxyTag(id, name);
    setTags((items) => items.map((item) => (item.id === id ? renamed : item)));
    return renamed;
  };

  const removeTag = async (id: string) => {
    await deleteProxyTag(id);
    setTags((items) => items.filter((item) => item.id !== id));
    setSubscriptions((items) =>
      items.map((item) => ({
        ...item,
        tagIds: (item.tagIds ?? []).filter((tagId) => tagId !== id),
      }))
    );
  };

  return (
    <MainPageShell activePage="proxy-subscriptions">
      <main class="proxy-page">
        <ProxySubscriptionTab
          subscriptions={subscriptions()}
          tags={tags()}
          loading={loading()}
          error={error()}
          selectedStatus={selectedStatus()}
          onSelectedStatusChange={selectStatus}
          onCreate={create}
          onUpdate={update}
          onDelete={(id) => void remove(id)}
          onRenameTag={renameTag}
          onDeleteTag={removeTag}
        />
      </main>
    </MainPageShell>
  );
};
