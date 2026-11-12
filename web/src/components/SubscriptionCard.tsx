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
import {
  BalanceInfoRows,
  oneTimeBalance,
  QuotaProgress,
  UsageWarnings,
  UsageWindows,
} from "./query-display";
import { ModelListDialog } from "./ModelListDialog";
import { ResetScheduleGrid } from "./ResetScheduleGrid";
import { TimetableAxis } from "./TimetableAxis";
import { createNow } from "../lib/useNow";
import { useSortableRow } from "../lib/dnd";
import { createDialogFocus } from "../lib/dialogFocus";
import { DragIcon } from "../components/icons.tsx";

interface SubscriptionCardProps {
  subscription: Subscription;
  /** 1-based position in the visible list; drives the 序号 column. */
  index?: number;
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

function cycleLabel(subscription: Subscription): string {
  if (subscription.subscriptionType === "one-time") return "一次性";
  return subscription.billingCycle === "yearly" ? "年付" : "月付";
}

/**
 * SubscriptionCard is one seven-column row of the timetable: 序号 / 服务 /
 * 金额 / 账单周期 / 状态 / 下次重置四轨 / 操作, sharing the header's grid
 * template so every rail lands under its date tick. Notes, reset schedules and
 * live query reads fold into a recessed detail line spanning columns 2–6.
 * The card keeps #28's query affordances (额度 / 模型), #29's auto-exhaust
 * linkage, #34's reset-time calibration and the two-step delete.
 */
export const SubscriptionCard: Component<SubscriptionCardProps> = (props) => {
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteStep, setDeleteStep] = createSignal<1 | 2>(1);
  const [modelsOpen, setModelsOpen] = createSignal(false);
  const sortable = useSortableRow(props.subscription.id);
  const now = createNow();

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

  // 一次性订阅的额度进度：当前值取实时查询到的可用额度，没查过就用台账里
  // 填写的余额；总值就是充值金额（price）。当前值超过总值按 100% 计。
  const quotaCurrent = () => balanceLabel().amount;
  const quotaTotal = () => props.subscription.price;

  const closeDelete = () => {
    setDeleteStep(1);
    setDeleteOpen(false);
  };

  const deleteFocus = createDialogFocus(closeDelete);
  const confirmFocus = createDialogFocus(() => query.setConfirmOpen(false));

  const toggleStatus = () => {
    if (!canToggleStatus()) return;
    props.onStatusChange(
      props.subscription.id,
      props.subscription.status === "active" ? "paused" : "active"
    );
  };

  const showsResetGrid = () =>
    Boolean(props.onScheduleToggle) &&
    isRecurring() &&
    (props.subscription.resetSchedules ?? []).length > 0;

  const hasDetails = () =>
    showsResetGrid() ||
    Boolean(query.balance()) ||
    Boolean(query.usage()) ||
    Boolean(query.error()) ||
    Boolean(props.subscription.notes);

  return (
    <article
      ref={sortable.ref}
      class="subscription-card"
      role="row"
      style={{ ...sortable.style(), opacity: sortable.isActive() ? 0.5 : 1 }}
    >
      <div class="cell cell-num" role="cell">
        <button
          type="button"
          class="priority-drag-handle"
          aria-label="拖拽排序"
          {...sortable.attrs}
          ref={sortable.attach}
        >
          <Show when={props.index !== undefined}>
            <span class="row-num">{props.index}</span>
          </Show>
          <DragIcon />
        </button>
      </div>

      <div class="cell cell-service" role="cell">
        <h3>{props.subscription.name}</h3>
        <p class="service-meta">
          <span>
            {getProviderName(
              props.subscription.provider,
              props.subscription.providerCustom,
              props.providers ?? []
            )}
          </span>
          <Show when={planName()}>
            <span aria-hidden="true">·</span>
            <span>{planName()}</span>
          </Show>
          <span aria-hidden="true">·</span>
          <span>{props.subscription.category}</span>
          <For each={subscriptionTags()}>
            {(tag) => <span class="tag-chip-label">{tag.name}</span>}
          </For>
        </p>
      </div>

      <div class="cell cell-amount" role="cell">
        <span class="cell-label">{isRecurring() ? "价格" : "充值金额"}</span>
        <span class="cell-amount-value">{priceLabel(props.subscription)}</span>
        <Show when={!isRecurring()}>
          <span class="cell-balance">
            余 <span class="balance-amount">{balanceLabel().text}</span>
            <Show when={balanceLabel().previous}>
              {(previous) => (
                <span class="balance-previous">（{previous()}）</span>
              )}
            </Show>
          </span>
          <QuotaProgress
            current={quotaCurrent()}
            total={quotaTotal()}
            label="额度余额"
          />
        </Show>
      </div>

      <div class="cell cell-cycle" role="cell">
        <span class="cell-cycle-main">{cycleLabel(props.subscription)}</span>
        <Show when={isRecurring()}>
          <span class="cell-cycle-type">
            {getTypeLabel(props.subscription.subscriptionType)}
          </span>
        </Show>
      </div>

      <div class="cell cell-status" role="cell">
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
          aria-pressed={
            canToggleStatus()
              ? props.subscription.status === "paused"
              : undefined
          }
          title={canToggleStatus() ? "切换状态" : undefined}
        >
          {getStatusLabel(props.subscription.status)}
        </button>
      </div>

      <div class="cell cell-axis" role="cell">
        <TimetableAxis
          renewalDate={props.subscription.renewalDate}
          resetSchedules={props.subscription.resetSchedules ?? []}
          oneTime={props.subscription.subscriptionType === "one-time"}
          now={now()}
        />
      </div>

      <div class="cell cell-actions" role="cell">
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
      </div>

      <Show when={hasDetails()}>
        <div class="subscription-card-details" role="cell" aria-colspan="5">
          <Show when={showsResetGrid()}>
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
          <Show when={query.balance()}>
            {(balance) => <BalanceInfoRows balance={balance()} />}
          </Show>
          <Show when={query.usage()}>
            {(usage) => <UsageWindows usage={usage()} />}
          </Show>
          <Show when={query.usage()}>
            {(usage) => <UsageWarnings warnings={usage().warnings} />}
          </Show>
          <Show when={query.error()}>
            <p class="subscription-card-query-error" role="alert">
              {query.error()}
            </p>
          </Show>
          <Show when={props.subscription.notes}>
            <div class="subscription-card-notes">
              <span>备注</span>
              <p>{props.subscription.notes}</p>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={deleteOpen()}>
        <div class="dialog-backdrop">
          <div
            class="dialog"
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            ref={deleteFocus.ref}
            onKeyDown={deleteFocus.onKeyDown}
          >
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
          <div
            class="dialog"
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            ref={confirmFocus.ref}
            onKeyDown={confirmFocus.onKeyDown}
          >
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
