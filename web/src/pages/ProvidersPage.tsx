// ProvidersPage (#43): read-only browser of the provider registry, ported from
import { CloseIcon, DragIcon } from "../components/icons.tsx";
// app/providers/page.tsx. Identity, capability badges, plans and the
// unregistered-provider section come from /api/providers and
// /api/providers/unregistered; the page does not mutate anything.

import { createSignal, For, onMount, Show, type Component } from "solid-js";
import { MainPageShell } from "../components/MainPageShell";
import {
  fetchProviderRegistry,
  fetchUnregisteredProviders,
} from "../subscriptions/api";
import type {
  CredentialField,
  EnrichedProvider,
  PlanDefinition,
  UnregisteredProviderName,
} from "../subscriptions/types";

/** UrlRow renders one labelled external link, or nothing when absent. */
const UrlRow: Component<{ label: string; url?: string }> = (props) => (
  <Show when={props.url}>
    <p class="provider-url">
      <span class="provider-url-label">{props.label}：</span>
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        {props.url}
      </a>
    </p>
  </Show>
);

const CredentialFields: Component<{ fields: CredentialField[] }> = (props) => (
  <Show when={props.fields.length > 0}>
    <div class="provider-fields">
      <h4>凭据字段</h4>
      <div class="provider-field-list">
        <For each={props.fields}>
          {(field) => (
            <span class="provider-field">
              {field.label}（{field.key} ·{" "}
              {field.type === "password" ? "密码" : "文本"}）
            </span>
          )}
        </For>
      </div>
    </div>
  </Show>
);

const Plans: Component<{ plans: PlanDefinition[] }> = (props) => (
  <Show when={props.plans.length > 0}>
    <div class="provider-plans">
      <h4>方案</h4>
      <div class="provider-plan-list">
        <For each={props.plans}>
          {(plan) => (
            <div class="provider-plan">
              <span class="provider-plan-name">{plan.name}</span>
              <span class="provider-plan-separator">·</span>
              <span>{plan.id}</span>
              <UrlRow label="用量查询 API" url={plan.usageApiUrl} />
              <UrlRow label="模型查询 API" url={plan.modelsApiUrl} />
            </div>
          )}
        </For>
      </div>
    </div>
  </Show>
);

const ProviderCard: Component<{ provider: EnrichedProvider }> = (props) => (
  <article class="provider-card">
    <header class="provider-card-header">
      <div class="provider-title-row">
        <h3>{props.provider.name}</h3>
        <span class="provider-id">{props.provider.id}</span>
        <Show when={props.provider.supportsBalanceQuery}>
          <span class="provider-badge provider-badge-success">
            支持余额查询
          </span>
        </Show>
        <Show when={props.provider.supportsUsageQuery}>
          <span class="provider-badge provider-badge-secondary">
            支持用量查询
          </span>
        </Show>
        <Show when={props.provider.supportsModelsQuery}>
          <span class="provider-badge provider-badge-outline">
            支持模型查询
          </span>
        </Show>
      </div>
      <Show when={props.provider.description}>
        <p class="provider-description">{props.provider.description}</p>
      </Show>
    </header>

    <p class="provider-meta">
      {props.provider.subscriptionCount} 个订阅 · {props.provider.toolCount}{" "}
      个工具
    </p>

    <Show when={props.provider.website}>
      <p class="provider-url provider-website">
        <a
          href={props.provider.website}
          target="_blank"
          rel="noopener noreferrer"
        >
          {props.provider.website}
        </a>
      </p>
    </Show>

    <UrlRow label="余额查询 API" url={props.provider.balanceApiUrl} />
    <UrlRow label="用量查询 API" url={props.provider.usageApiUrl} />
    <UrlRow label="模型查询 API" url={props.provider.modelsApiUrl} />

    <CredentialFields fields={props.provider.credentialFields ?? []} />
    <Plans plans={props.provider.plans ?? []} />
  </article>
);

export const ProvidersPage: Component = () => {
  const [providers, setProviders] = createSignal<EnrichedProvider[] | null>(
    null
  );
  const [unregistered, setUnregistered] = createSignal<
    UnregisteredProviderName[]
  >([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const [registry, names] = await Promise.all([
        fetchProviderRegistry(),
        fetchUnregisteredProviders(),
      ]);
      setProviders(registry);
      setUnregistered(names);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError)
      );
    } finally {
      setLoading(false);
    }
  });

  return (
    <MainPageShell activePage="providers">
      <main class="providers-page">
        <header class="providers-header">
          <h2>服务商管理</h2>
          <p class="tagline">浏览预定义服务商的完整配置与引用情况（只读）</p>
        </header>

        <Show when={error()}>
          <div class="error-banner" role="alert">
            <span>{error()}</span>
            <button
              type="button"
              class="ghost"
              aria-label="关闭错误提示"
              onClick={() => setError(null)}
            >
              <CloseIcon />
            </button>
          </div>
        </Show>

        <Show when={!loading()} fallback={<p class="loading">加载中...</p>}>
          <Show
            when={providers()}
            fallback={
              <p class="form-error" role="alert">
                加载失败：{error()}
              </p>
            }
          >
            {(registry) => (
              <section class="provider-grid" aria-label="服务商列表">
                <For each={registry()}>
                  {(provider) => <ProviderCard provider={provider} />}
                </For>
              </section>
            )}
          </Show>

          <section class="unregistered-section">
            <h2>未注册的服务商名称</h2>
            <p>订阅或工具选择「其他」时填写的自定义名称，按使用次数统计。</p>
            <Show
              when={unregistered().length > 0}
              fallback={
                <div class="unregistered-card">
                  <p class="unregistered-empty">
                    暂无使用中的自定义服务商名称。
                  </p>
                </div>
              }
            >
              <div class="unregistered-card">
                <For each={unregistered()}>
                  {(item) => (
                    <div class="unregistered-row">
                      <span class="unregistered-name">{item.name}</span>
                      <span class="unregistered-count">
                        {item.count} 次使用
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </Show>
      </main>
    </MainPageShell>
  );
};
