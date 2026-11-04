import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
  type Component,
} from "solid-js";
import { TagInput } from "./TagInput";
import { ResetScheduleConfig } from "./ResetScheduleConfig";
import {
  defaultCategories,
  type BillingCycle,
  type Provider,
  type Subscription,
  type SubscriptionFormData,
  type SubscriptionStatus,
  type SubscriptionType,
  type Tag,
} from "../subscriptions/types";

interface SubscriptionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: Subscription | null;
  categories: string[];
  tags: Tag[];
  providers: Provider[];
  onSubmit: (data: SubscriptionFormData) => Promise<boolean> | boolean;
}

const emptyFormData = (category: string): SubscriptionFormData => ({
  name: "",
  category,
  provider: "other",
  providerCustom: "",
  subscriptionType: "recurring",
  billingCycle: "monthly",
  price: 0,
  startDate: "",
  renewalDate: "",
  status: "active",
  notes: "",
  balance: undefined,
  lowBalanceThreshold: undefined,
  resetSchedules: [],
  planId: undefined,
  tagNames: [],
});

/**
 * SubscriptionForm ports components/SubscriptionForm.tsx for the subscription
 * core: identity, category, provider/plan, type and billing cycle, dates,
 * balance fields, status, notes, and tag input. Provider credential fields and
 * the connection test belong to the query framework (#28).
 */
export const SubscriptionForm: Component<SubscriptionFormProps> = (props) => {
  const [formData, setFormData] = createSignal<SubscriptionFormData>(
    emptyFormData(defaultCategories[0])
  );
  const [pendingTagInput, setPendingTagInput] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");

  const categories = createMemo(() =>
    props.categories.length ? props.categories : defaultCategories
  );
  const providers = createMemo<Provider[]>(() => props.providers);
  const providerConfig = createMemo(() =>
    providers().find((provider) => provider.id === formData().provider)
  );
  const plans = createMemo(() => providerConfig()?.plans ?? []);
  const showPlanSelector = createMemo(
    () => formData().subscriptionType === "recurring" && plans().length > 1
  );
  const isRecurring = createMemo(
    () => formData().subscriptionType === "recurring"
  );
  const billingCycle = createMemo(() => formData().billingCycle ?? "monthly");
  const showCustomProvider = createMemo(() => formData().provider === "other");

  // Editing pins the form to the subscription; opening fresh resets it. The
  // pending tag text resets in both cases so a stale value cannot leak into
  // the next save.
  createEffect(() => {
    const subscription = props.subscription;
    setPendingTagInput("");
    setError("");
    // Only the edited subscription drives the reset. Reading categories/tags
    // untracked keeps a background catalogue refresh from wiping the user's
    // half-filled form.
    untrack(() => {
      if (!subscription) {
        setFormData(emptyFormData(categories()[0] ?? defaultCategories[0]));
        return;
      }
      setFormData({
        name: subscription.name,
        category: subscription.category,
        provider: subscription.provider || "other",
        providerCustom: subscription.providerCustom || "",
        subscriptionType: subscription.subscriptionType || "recurring",
        billingCycle: subscription.billingCycle || "monthly",
        price: subscription.price,
        startDate: subscription.startDate || "",
        renewalDate: subscription.renewalDate || "",
        status: subscription.status,
        notes: subscription.notes || "",
        balance: subscription.balance,
        lowBalanceThreshold: subscription.lowBalanceThreshold,
        resetSchedules: subscription.resetSchedules || [],
        planId: subscription.planId,
        tagNames: (subscription.tagIds ?? [])
          .map((tagId) => props.tags.find((tag) => tag.id === tagId)?.name)
          .filter((name): name is string => Boolean(name)),
      });
    });
  });

  const patch = (values: Partial<SubscriptionFormData>) =>
    setFormData((previous) => ({ ...previous, ...values }));

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const pending = pendingTagInput().trim();
    const payload: SubscriptionFormData = {
      ...formData(),
      tagNames: pending
        ? Array.from(new Set([...(formData().tagNames ?? []), pending]))
        : formData().tagNames,
      // The old form sends an explicit null for a cleared threshold, which the
      // route normalizes to "overwrite with no value".
      lowBalanceThreshold: formData().lowBalanceThreshold ?? null,
    };

    setSubmitting(true);
    setError("");
    try {
      const saved = await props.onSubmit(payload);
      if (saved) props.onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="dialog-backdrop" role="presentation">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.subscription ? "编辑订阅" : "添加订阅"}
      >
        <h2>{props.subscription ? "编辑订阅" : "添加订阅"}</h2>
        <form onSubmit={handleSubmit}>
          <div class="form-grid">
            <label for="name">
              <span>名称 *</span>
              <input
                id="name"
                value={formData().name}
                onInput={(event) => patch({ name: event.currentTarget.value })}
                placeholder="输入订阅名称"
                required
                autocomplete="off"
              />
            </label>

            <label for="category">
              <span>分类 *</span>
              <select
                id="category"
                value={formData().category}
                onChange={(event) =>
                  patch({ category: event.currentTarget.value })
                }
              >
                <For each={categories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
            </label>

            <label for="provider">
              <span>提供商 *</span>
              <select
                id="provider"
                value={formData().provider}
                onChange={(event) =>
                  patch({
                    provider: event.currentTarget.value,
                    planId: undefined,
                  })
                }
              >
                <For each={providers()}>
                  {(provider) => (
                    <option value={provider.id}>{provider.name}</option>
                  )}
                </For>
                <Show when={!providers().length}>
                  <option value="other">其他</option>
                </Show>
              </select>
            </label>

            <Show when={showCustomProvider()}>
              <label for="providerCustom">
                <span>自定义提供商名称 *</span>
                <input
                  id="providerCustom"
                  value={formData().providerCustom ?? ""}
                  onInput={(event) =>
                    patch({ providerCustom: event.currentTarget.value })
                  }
                  placeholder="输入自定义提供商名称"
                  autocomplete="off"
                />
              </label>
            </Show>

            <Show when={showPlanSelector()}>
              <label for="planId">
                <span>方案 *</span>
                <select
                  id="planId"
                  value={formData().planId ?? ""}
                  onChange={(event) =>
                    patch({ planId: event.currentTarget.value || undefined })
                  }
                >
                  <option value="">选择方案</option>
                  <For each={plans()}>
                    {(plan) => <option value={plan.id}>{plan.name}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <label for="subscriptionType">
              <span>订阅类型 *</span>
              <select
                id="subscriptionType"
                value={formData().subscriptionType}
                onChange={(event) =>
                  patch({
                    subscriptionType: event.currentTarget
                      .value as SubscriptionType,
                    planId: undefined,
                  })
                }
              >
                <option value="recurring">周期性</option>
                <option value="one-time">一次性</option>
              </select>
            </label>

            <Show when={isRecurring()}>
              <label for="billingCycle">
                <span>计费周期 *</span>
                <select
                  id="billingCycle"
                  value={billingCycle()}
                  onChange={(event) =>
                    patch({
                      billingCycle: event.currentTarget.value as BillingCycle,
                    })
                  }
                >
                  <option value="monthly">月度</option>
                  <option value="yearly">年度</option>
                </select>
              </label>
            </Show>

            <label for="status">
              <span>状态</span>
              <select
                id="status"
                value={formData().status}
                onChange={(event) =>
                  patch({
                    status: event.currentTarget.value as SubscriptionStatus,
                  })
                }
              >
                <option value="active">活跃</option>
                <option value="paused">暂停</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>

            <label for="price">
              <span>
                {isRecurring()
                  ? billingCycle() === "yearly"
                    ? "价格 (¥/年) *"
                    : "价格 (¥/月) *"
                  : "充值金额 (¥) *"}
              </span>
              <input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={formData().price}
                onInput={(event) =>
                  patch({ price: parseFloat(event.currentTarget.value) || 0 })
                }
                placeholder="0.00"
                required
                autocomplete="off"
              />
            </label>

            <Show when={!isRecurring()}>
              <label for="balance">
                <span>余额 (¥)</span>
                <input
                  id="balance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData().balance ?? ""}
                  onInput={(event) => {
                    const raw = event.currentTarget.value;
                    patch({ balance: raw ? parseFloat(raw) : undefined });
                  }}
                  placeholder="手动输入余额"
                  autocomplete="off"
                />
              </label>

              <label for="lowBalanceThreshold">
                <span>低余额阈值 (¥)</span>
                <input
                  id="lowBalanceThreshold"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData().lowBalanceThreshold ?? ""}
                  onInput={(event) => {
                    const raw = event.currentTarget.value;
                    if (!raw) {
                      patch({ lowBalanceThreshold: undefined });
                      return;
                    }
                    const parsed = parseFloat(raw);
                    if (!Number.isNaN(parsed) && parsed >= 0) {
                      patch({ lowBalanceThreshold: parsed });
                    }
                  }}
                  placeholder="留空使用全局默认阈值"
                  autocomplete="off"
                />
              </label>
            </Show>

            <Show when={isRecurring()}>
              <label for="startDate">
                <span>开始日期 *</span>
                <input
                  id="startDate"
                  type="date"
                  value={formData().startDate ?? ""}
                  onInput={(event) =>
                    patch({ startDate: event.currentTarget.value })
                  }
                  required
                  autocomplete="off"
                />
              </label>

              <label for="renewalDate">
                <span>续费日期 *</span>
                <input
                  id="renewalDate"
                  type="date"
                  value={formData().renewalDate ?? ""}
                  onInput={(event) =>
                    patch({ renewalDate: event.currentTarget.value })
                  }
                  required
                  autocomplete="off"
                />
              </label>
            </Show>

            <Show when={isRecurring()}>
              <div class="form-field-wide">
                <ResetScheduleConfig
                  schedules={formData().resetSchedules ?? []}
                  onChange={(resetSchedules) => patch({ resetSchedules })}
                />
              </div>
            </Show>

            <div class="form-field-wide">
              <div class="form-label-row">
                <label for="subscription-tags">标签</label>
                <span class="form-hint">
                  {(formData().tagNames ?? []).length}/20
                </span>
              </div>
              <TagInput
                tags={props.tags}
                value={formData().tagNames ?? []}
                onChange={(tagNames) => patch({ tagNames })}
                onPendingChange={setPendingTagInput}
                disabled={submitting()}
              />
            </div>

            <label for="notes" class="form-field-wide">
              <span>备注</span>
              <input
                id="notes"
                value={formData().notes ?? ""}
                onInput={(event) => patch({ notes: event.currentTarget.value })}
                placeholder="可选备注信息"
                autocomplete="off"
              />
            </label>
          </div>

          <Show when={error()}>
            <p class="form-error" role="alert">
              {error()}
            </p>
          </Show>

          <div class="form-actions">
            <button
              type="button"
              class="ghost"
              onClick={() => props.onOpenChange(false)}
              disabled={submitting()}
            >
              取消
            </button>
            <button type="submit" disabled={submitting()}>
              {props.subscription ? "保存" : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
