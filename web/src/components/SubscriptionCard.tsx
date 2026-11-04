import { createSignal, For, Show, type Component } from "solid-js";
import type {
  Provider,
  Subscription,
  SubscriptionStatus,
  Tag,
} from "../subscriptions/types";
import { resolveStatus } from "../subscriptions/status";
import { ResetScheduleGrid } from "./ResetScheduleGrid";

interface SubscriptionCardProps {
  subscription: Subscription;
  tags?: Tag[];
  providers?: Provider[];
  onEdit: (subscription: Subscription) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: "active" | "paused") => void;
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
 * SubscriptionCard is the rendering baseline of components/SubscriptionCard.tsx
 * for ticket #26: identity, provider/plan, category, tags in association order,
 * type, price, renewal date, notes, status badge with manual toggle, and the
 * two-step delete confirmation. Query affordances (额度/模型 buttons, cooldown,
 * balance display) land with the query tickets (#28/#29).
 */
export const SubscriptionCard: Component<SubscriptionCardProps> = (props) => {
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteStep, setDeleteStep] = createSignal<1 | 2>(1);

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
    <article class="subscription-card">
      <header class="subscription-card-header">
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
      </dl>

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
    </article>
  );
};
