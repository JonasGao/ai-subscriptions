// Port of components/subscription-card/balance-display.tsx and the usage
// rendering the card needs: balance rows, the one-time balance line with its
// previous-value comparison, and the usage window list.

import { For, Show, type Component } from "solid-js";
import type {
  BalanceInfo,
  BalanceResult,
  Subscription,
  UsageWindow,
} from "../subscriptions/types";
import { formatBalance, getProviderCurrency } from "../subscriptions/format";
import { getProgressTier, getUsagePercent } from "../subscriptions/usage";

/** BalanceInfoRows renders the non-null amount lines of a balance result. */
export const BalanceInfoRows: Component<{ balance: BalanceResult }> = (
  props
) => (
  <For each={props.balance.balanceInfos}>
    {(info: BalanceInfo) => (
      <>
        <Show when={info.total !== null}>
          <div class="balance-row">
            <dt>总额度</dt>
            <dd>{formatBalance(info.total!, info.currency)}</dd>
          </div>
        </Show>
        <Show when={info.toppedUp !== null}>
          <div class="balance-row">
            <dt>充值余额</dt>
            <dd>{formatBalance(info.toppedUp!, info.currency)}</dd>
          </div>
        </Show>
        <Show when={info.granted !== null}>
          <div class="balance-row">
            <dt>赠送额度</dt>
            <dd>{formatBalance(info.granted!, info.currency)}</dd>
          </div>
        </Show>
        <Show when={info.used !== null}>
          <div class="balance-row">
            <dt>已使用</dt>
            <dd>{formatBalance(info.used!, info.currency)}</dd>
          </div>
        </Show>
        <Show when={info.frozen !== null}>
          <div class="balance-row">
            <dt>冻结金额</dt>
            <dd>{formatBalance(info.frozen!, info.currency)}</dd>
          </div>
        </Show>
        <For each={info.extras ?? []}>
          {(extra) => (
            <div class="balance-row">
              <dt>{extra.label}</dt>
              <dd>{extra.value}</dd>
            </div>
          )}
        </For>
      </>
    )}
  </For>
);

/**
 * oneTimeBalance renders the persisted balance unless a live query just
 * replaced it, in which case the previous amount is shown in parentheses —
 * only when the two differ.
 */
export function oneTimeBalance(
  subscription: Subscription,
  balance: BalanceResult | null,
  previousBalance: { amount: number; currency: string } | null
): { text: string; previous: string | null } {
  const currency =
    balance?.balanceInfos[0]?.currency ??
    subscription.balanceCurrency ??
    getProviderCurrency(subscription.provider);

  const first = balance?.balanceInfos[0];
  if (first) {
    const previousLabel = previousBalance
      ? formatBalance(previousBalance.amount, previousBalance.currency)
      : subscription.balance != null
        ? formatBalance(subscription.balance, currency)
        : null;
    const newAmount = parseFloat(first.available);
    const oldAmount = previousBalance
      ? previousBalance.amount
      : (subscription.balance ?? NaN);
    const showPrevious =
      previousLabel !== null &&
      Number.isFinite(oldAmount) &&
      Number.isFinite(newAmount) &&
      newAmount !== oldAmount;
    return {
      text: formatBalance(first.available, currency),
      previous: showPrevious ? previousLabel : null,
    };
  }

  return {
    text:
      subscription.balance != null
        ? formatBalance(subscription.balance, currency)
        : "-",
    previous: null,
  };
}

const USAGE_LABELS: {
  key: "fiveHour" | "weekly" | "monthly";
  label: string;
}[] = [
  { key: "fiveHour", label: "5 小时" },
  { key: "weekly", label: "每周" },
  { key: "monthly", label: "每月" },
];

/**
 * UsageWindowRow renders one usage bucket: the amounts, the rounded ratio and
 * the threshold-colored progress bar. The ratio helpers return null when the
 * limit is missing/zero/negative — the old stack hid the percent label and the
 * bar in that case instead of rendering a misleading "0%".
 */
const UsageWindowRow: Component<{ label: string; window: UsageWindow }> = (
  props
) => {
  const percent = () => getUsagePercent(props.window.used, props.window.limit);
  const tier = () => {
    const value = percent();
    return value === null ? null : getProgressTier(value);
  };
  const rounded = () => Math.round(percent() ?? 0);

  return (
    <div class="usage-block">
      <div class="usage-row">
        <span class="usage-label">{props.label}</span>
        <span class="usage-amount">
          {props.window.used} / {props.window.limit}
        </span>
        <Show when={percent() !== null}>
          <span class="usage-percent">{percent()!.toFixed(1)}%</span>
        </Show>
      </div>
      <Show when={tier()}>
        {(value) => (
          <div
            class="usage-progress"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={rounded()}
          >
            <div
              class={`usage-progress-fill ${value()}`}
              style={{ width: `${rounded()}%` }}
            />
          </div>
        )}
      </Show>
    </div>
  );
};

/**
 * UsageWindows renders the non-null usage buckets with their consumption
 * ratio and normal/warning/danger progress tier. Reset-time urgency coloring
 * belongs to the countdown ticket (#27/#40).
 */
export const UsageWindows: Component<{
  usage: {
    fiveHour: UsageWindow | null;
    weekly: UsageWindow | null;
    monthly: UsageWindow | null;
  };
}> = (props) => (
  <For each={USAGE_LABELS}>
    {(entry) => (
      <Show when={props.usage[entry.key]}>
        {(window) => <UsageWindowRow label={entry.label} window={window()} />}
      </Show>
    )}
  </For>
);
