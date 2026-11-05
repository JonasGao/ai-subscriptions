import { createSignal, For, Show, type Component } from "solid-js";
import type {
  Provider,
  Subscription,
  SubscriptionStatus,
  Tag,
} from "../subscriptions/types";
import { resolveStatus } from "../subscriptions/status";
import { createSubscriptionQuery } from "../subscriptions/query";
import {
  resolveModelsApiUrl,
  resolveModelsRequireCredentials,
  resolveQueryKind,
} from "../subscriptions/urls";
import { BalanceInfoRows, oneTimeBalance, UsageWindows } from "./query-display";
import { ModelListDialog } from "./ModelListDialog";
import { ResetScheduleGrid } from "./ResetScheduleGrid";
import { useSortableRow } from "../priorities/dnd";

interface SubscriptionCardProps {
  subscription: Subscription;
  tags?: Tag[];
  providers?: Provider[];
  onEdit: (subscription: Subscription) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: "active" | "paused") => void;
  onBalanceUpdate?: (id: string, balance: number, currency: string) => void;
  onSubscriptionUpdate?: (subscription: Subscription) => void;
  /** Manual schedule exhaustion switch (ADR-0007); omitted disables the grid. */
  onScheduleToggle?: (
    subscriptionId: string,
    scheduleId: string,
    exhausted: boolean
  ) => void;
}

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "活跃",
  paused: "暂停",
  cancelled: "已取消",
};

export function getStatusLabel(status: SubscriptionStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function getPlanName(
  provider: string | undefined,
  planId: string | undefined,
  providers: Provider[]
): string | null {
  if (!planId) return null;
  const found = providers.find((item) => item.id === provider);
  return found?.plans?.find((plan) => plan.id === planId)?.name ?? null;
}

export function getProviderName(
  provider: string,
  providerCustom: string | undefined,
  providers: Provider[]
): string {
  if (provider === "other" && providerCustom) return providerCustom;
  const found = providers.find((item) => item.id === provider);
  return found?.name || provider;
}

export function getTypeLabel(type: string): string {
  return type === "recurring" ? "周期性" : "一次性";
}

function priceLabel(subscription: Subscription): string {
  const amount = `¥${subscription.price.toFixed(2)}`;
  if (subscription.subscriptionType === "one-time") return amount;
  return subscription.billingCycle === "yearly"
    ? `${amount}/年`
    : `${amount}/月`;
}

/**
 * SubscriptionCard renders one subscription: identity, provider/plan, category,
 * tags in association order, type, price, renewal date, notes, status badge with
 * manual toggle, the two-step delete confirmation, and (from #28) the live quota
 * query affordances — 额度 for usage/balance per subscription type and planId,
 * 模型 for model listing.
 *
 * #29 adds the usage-window auto-exhaust linkage; #34 adds reset-time
 * calibration. The usage window rendering covers what #28's demo needs.
 */
export const SubscriptionCard: Component<SubscriptionCardProps> = (props) => {
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteStep, setDeleteStep] = createSignal<1 | 2>(1);
  const [modelsOpen, setModelsOpen] = createSignal(false);
  const sortable = useSortableRow(props.subscription.id);

  const subscriptionTags = () =>
    (props.subscription.tagIds ?? [])
      .map((tagId) => (props.tags ?? []).find((tag) => tag.id === tagId))
      .filter((tag): tag is Tag => Boolean(tag));

  const isRecurring = () => props.subscription.subscriptionType === "recurring";
  const canToggleStatus = () =>
    props.subscription.status === "active" ||
    props.subscription.status === "paused";
  const statusReason = () => resolveStatus(props.subscription);
  const planName = () =>
    getPlanName(
      props.subscription.provider,
      props.subscription.planId,
      props.providers ?? []
    );

  const providerConfig = () =>
    (props.providers ?? []).find(
      (item) => item.id === props.subscription.provider
    );

  const queryKind = () =>
    resolveQueryKind(
      providerConfig(),
      props.subscription.subscriptionType,
      props.subscription.planId
    );

  const canQueryModels = () => {
    const provider = providerConfig();
    if (!provider) return false;
    return Boolean(resolveModelsApiUrl(provider, props.subscription.planId));
  };

  const modelsRequireCredentials = () => {
    const provider = providerConfig();
    if (!provider) return true;
    return resolveModelsRequireCredentials(provider, props.subscription.planId);
  };

  const query = createSubscriptionQuery({
    subscription: props.subscription,
    canQuery: () => queryKind() !== null,
    onEdit: props.onEdit,
    onBalanceUpdate: props.onBalanceUpdate,
    onSubscriptionUpdate: props.onSubscriptionUpdate,
    onScheduleToggle: props.onScheduleToggle,
  });

  const handleModelsClick = () => {
    // Auth-required endpoints with no credentials open the edit dialog; public
    // endpoints (modelsRequireCredentials: false) open the list directly.
    if (modelsRequireCredentials() && !props.subscription.hasCredentials) {
      props.onEdit(props.subscription);
      return;
    }
    setModelsOpen(true);
  };

  const balanceLabel = () =>
    oneTimeBalance(
      props.subscription,
      query.balance(),
      query.previousBalance()
    );

  const closeDelete = () => {
    setDeleteStep(1);
    setDeleteOpen(false);
  };

  const toggleStatus = () => {
    if (!canToggleStatus()) return;
    props.onStatusChange(
      props.subscription.id,
      props.subscription.status === "active" ? "paused" : "active"
    );
  };

  return (
    <article
      ref={sortable.ref}
      class="subscription-card"
      style={{ ...sortable.style(), opacity: sortable.isActive() ? 0.5 : 1 }}
    >
      <header class="subscription-card-header">
        <button
          type="button"
          class="priority-drag-handle"
          aria-label="拖拽排序"
          {...sortable.attrs}
          ref={sortable.attach}
        >
          ⋮⋮
        </button>
        <h3>{props.subscription.name}</h3>
        <div class="subscription-card-badges">
          <Show
            when={
              statusReason().reason.kind === "schedule-exhausted" &&
              (statusReason().reason as { scheduleIds: string[] }).scheduleIds
                .length > 0
            }
          >
            <span class="quota-exhausted">额度用尽</span>
          </Show>
          <button
            type="button"
            class={`status-badge status-${props.subscription.status}`}
            classList={{ clickable: canToggleStatus() }}
            onClick={toggleStatus}
            title={canToggleStatus() ? "切换状态" : undefined}
          >
            {getStatusLabel(props.subscription.status)}
          </button>
        </div>
      </header>

      <dl class="subscription-card-fields">
        <div>
          <dt>提供商</dt>
          <dd>
            {getProviderName(
              props.subscription.provider,
              props.subscription.providerCustom,
              props.providers ?? []
            )}
          </dd>
        </div>
        <Show when={planName()}>
          <div>
            <dt>方案</dt>
            <dd>{planName()}</dd>
          </div>
        </Show>
        <div>
          <dt>分类</dt>
          <dd>{props.subscription.category}</dd>
        </div>
        <Show when={subscriptionTags().length > 0}>
          <div>
            <dt>标签</dt>
            <dd class="subscription-card-tags">
              <For each={subscriptionTags()}>
                {(tag) => <span class="tag-chip-label">{tag.name}</span>}
              </For>
            </dd>
          </div>
        </Show>
        <div>
          <dt>类型</dt>
          <dd>{getTypeLabel(props.subscription.subscriptionType)}</dd>
        </div>
        <div>
          <dt>{isRecurring() ? "价格" : "充值金额"}</dt>
          <dd>{priceLabel(props.subscription)}</dd>
        </div>
        <Show when={isRecurring() && props.subscription.renewalDate}>
          <div>
            <dt>续费日期</dt>
            <dd>{props.subscription.renewalDate}</dd>
          </div>
        </Show>
        <Show when={!isRecurring()}>
          <div class="subscription-card-balance">
            <dt>余额</dt>
            <dd>
              <span class="balance-amount">{balanceLabel().text}</span>
              <Show when={balanceLabel().previous}>
                {(previous) => (
                  <span class="balance-previous">（{previous()}）</span>
                )}
              </Show>
            </dd>
          </div>
        </Show>
        <Show when={query.balance()}>
          {(balance) => <BalanceInfoRows balance={balance()} />}
        </Show>
        <Show when={query.usage()}>
          {(usage) => <UsageWindows usage={usage()} />}
        </Show>
      </dl>

      <Show when={query.error()}>
        <p class="subscription-card-query-error" role="alert">
          {query.error()}
        </p>
      </Show>

      <Show
        when={
          props.onScheduleToggle &&
          isRecurring() &&
          (props.subscription.resetSchedules ?? []).length > 0
        }
      >
        <ResetScheduleGrid
          schedules={props.subscription.resetSchedules ?? []}
          onToggle={(scheduleId, exhausted) =>
            props.onScheduleToggle?.(
              props.subscription.id,
              scheduleId,
              exhausted
            )
          }
        />
      </Show>

      <Show when={props.subscription.notes}>
        <div class="subscription-card-notes">
          <span>备注</span>
          <p>{props.subscription.notes}</p>
        </div>
      </Show>

      <footer class="subscription-card-actions">
        <Show when={queryKind() !== null}>
          <button
            type="button"
            class="quota-query"
            onClick={query.handleQueryClick}
            disabled={query.loading()}
            title={
              query.inCooldown() && !query.loading()
                ? "60 秒内已查询过，再次点击需确认"
                : "查询额度"
            }
          >
            额度
          </button>
        </Show>
        <Show when={canQueryModels()}>
          <button
            type="button"
            class="model-query"
            onClick={handleModelsClick}
            title="模型列表"
          >
            模型
          </button>
        </Show>
        <button
          type="button"
          onClick={() => props.onEdit(props.subscription)}
          title="编辑"
        >
          编辑
        </button>
        <button
          type="button"
          class="danger"
          onClick={() => setDeleteOpen(true)}
          title="删除"
        >
          删除
        </button>
      </footer>

      <Show when={deleteOpen()}>
        <div class="dialog-backdrop">
          <div class="dialog" role="dialog" aria-modal="true">
            <h2>{deleteStep() === 1 ? "确认删除订阅" : "再次确认删除"}</h2>
            <p>
              {deleteStep() === 1
                ? `确定要删除订阅「${props.subscription.name}」吗？`
                : `删除后无法恢复「${props.subscription.name}」，确定继续吗？`}
            </p>
            <div class="form-actions">
              <button type="button" class="ghost" onClick={closeDelete}>
                取消
              </button>
              <Show
                when={deleteStep() === 1}
                fallback={
                  <button
                    type="button"
                    class="danger"
                    onClick={() => {
                      closeDelete();
                      props.onDelete(props.subscription.id);
                    }}
                  >
                    确认删除
                  </button>
                }
              >
                <button
                  type="button"
                  class="danger"
                  onClick={() => setDeleteStep(2)}
                >
                  继续删除
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <Show when={query.confirmOpen()}>
        <div class="dialog-backdrop">
          <div class="dialog" role="dialog" aria-modal="true">
            <h2>再次查询确认</h2>
            <p>距上次查询不足 60 秒，确定要再次查询吗？</p>
            <div class="form-actions">
              <button
                type="button"
                class="ghost"
                onClick={() => query.setConfirmOpen(false)}
              >
                取消
              </button>
              <button type="button" onClick={query.handleConfirmQuery}>
                确认查询
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={canQueryModels()}>
        <ModelListDialog
          open={modelsOpen()}
          onOpenChange={setModelsOpen}
          subscriptionId={props.subscription.id}
        />
      </Show>
    </article>
  );
};
