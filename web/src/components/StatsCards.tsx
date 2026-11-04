import { createMemo, type Component } from "solid-js";
import type { Subscription } from "../subscriptions/types";
import {
  calculateMonthlyTotal,
  calculateOneTimeTotal,
  calculateYearlyTotal,
} from "../subscriptions/format";

export interface StatsCardsProps {
  subscriptions: Subscription[];
}

/**
 * StatsCards mirrors components/StatsCards.tsx: four summary tiles over the
 * currently visible subscriptions (the list page passes its filtered set).
 */
export const StatsCards: Component<StatsCardsProps> = (props) => {
  const recurringCount = createMemo(
    () =>
      props.subscriptions.filter(
        (subscription) => subscription.subscriptionType === "recurring"
      ).length
  );
  const oneTimeCount = createMemo(
    () =>
      props.subscriptions.filter(
        (subscription) => subscription.subscriptionType === "one-time"
      ).length
  );
  const monthlyTotal = createMemo(() => calculateMonthlyTotal(props.subscriptions));
  const yearlyTotal = createMemo(() => calculateYearlyTotal(props.subscriptions));
  const oneTimeTotal = createMemo(() => calculateOneTimeTotal(props.subscriptions));

  return (
    <section class="stats-cards" aria-label="订阅统计">
      <article class="stats-card">
        <h2>月度总支出</h2>
        <p class="stats-value">¥{monthlyTotal().toFixed(2)}</p>
        <p class="stats-hint">周期性订阅 ({recurringCount()}个)</p>
      </article>
      <article class="stats-card">
        <h2>年度预估</h2>
        <p class="stats-value">¥{yearlyTotal().toFixed(2)}</p>
        <p class="stats-hint">周期性订阅年度费用</p>
      </article>
      <article class="stats-card">
        <h2>一次性充值</h2>
        <p class="stats-value">¥{oneTimeTotal().toFixed(2)}</p>
        <p class="stats-hint">活跃充值 ({oneTimeCount()}个)</p>
      </article>
      <article class="stats-card">
        <h2>订阅总数</h2>
        <p class="stats-value">{props.subscriptions.length}</p>
        <p class="stats-hint">
          周期性 {recurringCount()} · 一次性 {oneTimeCount()}
        </p>
      </article>
    </section>
  );
};
