import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  type Component,
} from "solid-js";
import {
  calculateProxyExpirationDate,
  getProxyDateNotice,
  getProxyTodayDate,
  isDateOnly,
  type ProxySubscriptionStatus,
} from "./dates";
import { TagInput } from "./TagInput";
import { ProxyTagManagerDialog } from "./ProxyTagManagerDialog";
import type {
  ProxySubscription,
  ProxySubscriptionFormData,
  ProxySubscriptionTag,
} from "./api";

// ProxySubscriptionTab is the SolidJS port of components/ProxySubscriptionTab.tsx
// (ADR-0009): CRUD over names, monthly price, optional expiration date, URL and
// notes, a manual status switch, and a proxy-only tag catalog.

const statusLabels: Record<ProxySubscriptionStatus, string> = {
  unused: "未使用",
  "in-use": "正在使用",
  expired: "已过期",
};
const statuses = Object.keys(statusLabels) as ProxySubscriptionStatus[];

type SortKey = "date" | "expiration" | "price" | "name";

function today() {
  return getProxyTodayDate();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function money(value: number) {
  return `¥${value.toFixed(2)}`;
}

export interface ProxySubscriptionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: ProxySubscription | null;
  tags: ProxySubscriptionTag[];
  onSubmit: (data: ProxySubscriptionFormData) => Promise<boolean>;
}

/**
 * ProxySubscriptionForm renders the create/edit dialog. It stays mounted while
 * closed so its controls exist for the surrounding page, but only the open
 * state is interactive.
 *
 * The pending tag text is committed on submit: a name typed into the tag box is
 * saved even when the user never pressed Enter (the behaviour the parity test
 * locks, carried over from the old form).
 */
export const ProxySubscriptionForm: Component<ProxySubscriptionFormProps> = (
  props
) => {
  const editing = () => props.subscription;
  const [name, setName] = createSignal("");
  const [monthlyPrice, setMonthlyPrice] = createSignal("0");
  const [expirationDate, setExpirationDate] = createSignal("");
  const [hasExpiration, setHasExpiration] = createSignal(true);
  const [website, setWebsite] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [status, setStatus] = createSignal<ProxySubscriptionStatus>("unused");
  const [tagNames, setTagNames] = createSignal<string[]>([]);
  const [pendingTagInput, setPendingTagInput] = createSignal("");
  const [dateMode, setDateMode] = createSignal<"expiration" | "duration">(
    "duration"
  );
  const [startDate, setStartDate] = createSignal(today());
  const [durationDays, setDurationDays] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  // Re-seed the fields whenever the dialog opens for a different record.
  let seededFor: string | null | undefined;
  createEffect(() => {
    if (!props.open) {
      seededFor = undefined;
      return;
    }
    const key = editing()?.id ?? null;
    if (seededFor === key) return;
    seededFor = key;
    const current = editing();
    if (current) {
      setName(current.name);
      setMonthlyPrice(String(current.monthlyPrice));
      setExpirationDate(current.expirationDate ?? "");
      setHasExpiration(!!current.expirationDate);
      setWebsite(current.website ?? "");
      setNotes(current.notes ?? "");
      setStatus(current.status);
      setTagNames(
        (current.tagIds ?? [])
          .map((id) => props.tags.find((tag) => tag.id === id)?.name)
          .filter((tagName): tagName is string => !!tagName)
      );
      setDateMode("expiration");
      setStartDate(today());
      setDurationDays("");
    } else {
      setName("");
      setMonthlyPrice("0");
      setExpirationDate("");
      setHasExpiration(true);
      setWebsite("");
      setNotes("");
      setStatus("unused");
      setTagNames([]);
      setDateMode("duration");
      setStartDate(today());
      setDurationDays("");
    }
    setError(null);
    setPendingTagInput("");
  });

  const calculatedExpiration = () => {
    const days = Number(durationDays());
    return dateMode() === "duration" &&
      isDateOnly(startDate()) &&
      /^\d+$/.test(durationDays()) &&
      days > 0
      ? calculateProxyExpirationDate(startDate(), days)
      : "";
  };

  const effectiveExpiration = (): string | undefined => {
    if (!hasExpiration()) return undefined;
    return dateMode() === "duration"
      ? calculatedExpiration() || undefined
      : expirationDate() || undefined;
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    if (!name().trim()) return setError("请输入代理订阅名称");
    if (!Number.isFinite(Number(monthlyPrice())) || Number(monthlyPrice()) < 0) {
      return setError("请输入有效的单月价格");
    }
    const expiration = effectiveExpiration();
    if (hasExpiration() && !expiration) {
      return setError(
        dateMode() === "duration" ? "请输入有效的订阅天数" : "请输入到期日期"
      );
    }

    setSubmitting(true);
    try {
      const pending = pendingTagInput().trim();
      const ok = await props.onSubmit({
        name: name().trim(),
        monthlyPrice: Number(monthlyPrice()),
        // An explicit empty string clears a stored date; omitting the key
        // would mean "leave unchanged" on the wire.
        expirationDate: expiration ?? "",
        website: website().trim() || undefined,
        notes: notes() || undefined,
        status: status(),
        tagNames: pending
          ? Array.from(new Set([...tagNames(), pending]))
          : tagNames(),
      });
      if (ok) props.onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open}>
      <div class="proxy-dialog-backdrop" role="presentation">
        <div class="proxy-dialog" role="dialog" aria-modal="true">
          <header class="proxy-dialog-header">
            <h2>{editing() ? "编辑代理订阅" : "添加代理订阅"}</h2>
            <p class="tagline">记录代理服务的价格、到期日期和使用状态。</p>
          </header>
          <form onSubmit={submit} class="proxy-form">
            <label class="proxy-field" for="proxy-name">
              <span>名字</span>
              <input
                id="proxy-name"
                value={name()}
                maxlength={200}
                required
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>

            <div class="proxy-grid">
              <label class="proxy-field" for="proxy-price">
                <span>单月价格（元）</span>
                <input
                  id="proxy-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={monthlyPrice()}
                  required
                  onInput={(event) => setMonthlyPrice(event.currentTarget.value)}
                />
              </label>
              <label class="proxy-field" for="proxy-status">
                <span>状态</span>
                <select
                  id="proxy-status"
                  value={status()}
                  onChange={(event) =>
                    setStatus(event.currentTarget.value as ProxySubscriptionStatus)
                  }
                >
                  <For each={statuses}>
                    {(value) => <option value={value}>{statusLabels[value]}</option>}
                  </For>
                </select>
              </label>
            </div>

            <fieldset class="proxy-fieldset">
              <legend>有效期</legend>
              <label class="proxy-radio" for="proxy-has-expiration">
                <input
                  id="proxy-has-expiration"
                  type="radio"
                  name="proxy-has-expiration"
                  checked={hasExpiration()}
                  onChange={() => setHasExpiration(true)}
                />
                <span>设置到期日期</span>
              </label>
              <label class="proxy-radio" for="proxy-unlimited">
                <input
                  id="proxy-unlimited"
                  type="radio"
                  name="proxy-has-expiration"
                  checked={!hasExpiration()}
                  onChange={() => setHasExpiration(false)}
                />
                <span>无限期（按流量）</span>
              </label>

              <Show when={hasExpiration()}>
                <label class="proxy-radio" for="proxy-duration">
                  <input
                    id="proxy-duration"
                    type="radio"
                    name="proxy-date-mode"
                    checked={dateMode() === "duration"}
                    onChange={() => {
                      setDateMode("duration");
                      setStartDate(today());
                      setDurationDays("");
                    }}
                  />
                  <span>起始日期 + 可用天数</span>
                </label>
                <label class="proxy-radio" for="proxy-expiration">
                  <input
                    id="proxy-expiration"
                    type="radio"
                    name="proxy-date-mode"
                    checked={dateMode() === "expiration"}
                    onChange={() => setDateMode("expiration")}
                  />
                  <span>直接输入到期日期</span>
                </label>

                <Show
                  when={dateMode() === "duration"}
                  fallback={
                    <label class="proxy-field" for="proxy-expiration-date">
                      <span>到期日期</span>
                      <input
                        id="proxy-expiration-date"
                        type="date"
                        value={expirationDate()}
                        onInput={(event) =>
                          setExpirationDate(event.currentTarget.value)
                        }
                      />
                    </label>
                  }
                >
                  <div class="proxy-grid">
                    <label class="proxy-field" for="proxy-start">
                      <span>起始日期</span>
                      <input
                        id="proxy-start"
                        type="date"
                        value={startDate()}
                        onInput={(event) => setStartDate(event.currentTarget.value)}
                      />
                    </label>
                    <label class="proxy-field" for="proxy-days">
                      <span>可用天数</span>
                      <input
                        id="proxy-days"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="例如 30"
                        value={durationDays()}
                        onInput={(event) =>
                          setDurationDays(event.currentTarget.value)
                        }
                      />
                    </label>
                  </div>
                  <Show when={calculatedExpiration()}>
                    <p class="proxy-note">
                      到期日期：{formatDate(calculatedExpiration())}
                    </p>
                  </Show>
                </Show>
              </Show>
            </fieldset>

            <div class="proxy-field">
              <span>标签</span>
              <TagInput
                tags={props.tags}
                value={tagNames()}
                onChange={setTagNames}
                onPendingChange={setPendingTagInput}
                disabled={submitting()}
              />
            </div>

            <label class="proxy-field" for="proxy-website">
              <span>网站地址</span>
              <input
                id="proxy-website"
                type="url"
                placeholder="https://example.com"
                value={website()}
                onInput={(event) => setWebsite(event.currentTarget.value)}
              />
            </label>

            <label class="proxy-field" for="proxy-notes">
              <span>备注</span>
              <textarea
                id="proxy-notes"
                rows={4}
                maxlength={2000}
                value={notes()}
                onInput={(event) => setNotes(event.currentTarget.value)}
              />
            </label>

            <Show when={error()}>
              <p class="auth-error" role="alert">
                {error()}
              </p>
            </Show>

            <footer class="proxy-dialog-footer">
              <button
                type="button"
                class="ghost"
                onClick={() => props.onOpenChange(false)}
              >
                取消
              </button>
              <button type="submit" disabled={submitting()}>
                {submitting() ? "保存中..." : "保存"}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </Show>
  );
};

const ProxySubscriptionCard: Component<{
  subscription: ProxySubscription;
  tags: ProxySubscriptionTag[];
  onEdit: () => void;
  onDelete: () => void;
}> = (props) => {
  const notice = () => getProxyDateNotice(props.subscription);
  const subscriptionTags = () =>
    (props.subscription.tagIds ?? [])
      .map((id) => props.tags.find((tag) => tag.id === id))
      .filter((tag): tag is ProxySubscriptionTag => !!tag);

  return (
    <article class="proxy-card">
      <header>
        <h3>{props.subscription.name}</h3>
        <span class={`proxy-status proxy-status-${props.subscription.status}`}>
          {statusLabels[props.subscription.status]}
        </span>
      </header>
      <Show when={subscriptionTags().length > 0}>
        <ul class="proxy-tag-list">
          <For each={subscriptionTags()}>
            {(tag) => <li class="proxy-tag">{tag.name}</li>}
          </For>
        </ul>
      </Show>
      <dl class="proxy-facts">
        <dt>单月价格</dt>
        <dd>{money(props.subscription.monthlyPrice)}</dd>
        <dt>到期日期</dt>
        <dd>
          {props.subscription.expirationDate
            ? formatDate(props.subscription.expirationDate)
            : "无限期"}
        </dd>
      </dl>
      <Show when={notice().kind === "remaining"}>
        <p class="proxy-notice">剩余 {notice().days} 天</p>
      </Show>
      <Show when={notice().kind === "today"}>
        <p class="proxy-notice">今天到期</p>
      </Show>
      <Show when={notice().kind === "overdue"}>
        <p class="proxy-notice proxy-notice-overdue">已逾期 {notice().days} 天</p>
      </Show>
      <Show when={props.subscription.website}>
        {(site) => (
          <a href={site()} target="_blank" rel="noreferrer" class="proxy-link">
            {site()}
          </a>
        )}
      </Show>
      <Show when={props.subscription.notes}>
        {(value) => <p class="proxy-notes">{value()}</p>}
      </Show>
      <footer>
        <button type="button" title="编辑代理订阅" onClick={props.onEdit}>
          编辑
        </button>
        <button type="button" title="删除代理订阅" onClick={props.onDelete}>
          删除
        </button>
      </footer>
    </article>
  );
};

export interface ProxySubscriptionTabProps {
  subscriptions: ProxySubscription[];
  tags: ProxySubscriptionTag[];
  loading: boolean;
  error: string | null;
  selectedStatus: string;
  onSelectedStatusChange: (value: string) => void;
  onCreate: (data: ProxySubscriptionFormData) => Promise<boolean>;
  onUpdate: (id: string, data: ProxySubscriptionFormData) => Promise<boolean>;
  onDelete: (id: string) => void;
  onRenameTag: (id: string, name: string) => Promise<ProxySubscriptionTag>;
  onDeleteTag: (id: string) => Promise<void>;
  confirmDelete?: (message: string) => boolean;
}

/**
 * ProxySubscriptionTab renders the page body. Data loading lives in the page so
 * the tab stays a pure view over props — the old component fetched on mount,
 * but the Solid page owns fetching once for the whole route.
 */
export const ProxySubscriptionTab: Component<ProxySubscriptionTabProps> = (
  props
) => {
  const [sortKey, setSortKey] = createSignal<SortKey>("date");
  const [formOpen, setFormOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<ProxySubscription | null>(null);

  const filtered = createMemo(() =>
    props.subscriptions
      .filter(
        (item) =>
          props.selectedStatus === "all" || item.status === props.selectedStatus
      )
      .sort((a, b) =>
        sortKey() === "name"
          ? a.name.localeCompare(b.name)
          : sortKey() === "price"
            ? b.monthlyPrice - a.monthlyPrice
            : sortKey() === "expiration"
              ? (b.expirationDate ?? "").localeCompare(a.expirationDate ?? "")
              : b.createdAt.localeCompare(a.createdAt)
      )
  );

  const totalPrice = createMemo(() =>
    filtered().reduce((sum, item) => sum + item.monthlyPrice, 0)
  );

  const submit = async (data: ProxySubscriptionFormData) => {
    const current = editing();
    return current ? props.onUpdate(current.id, data) : props.onCreate(data);
  };

  const remove = (subscription: ProxySubscription) => {
    const confirmFn =
      props.confirmDelete ?? ((message: string) => window.confirm(message));
    if (!confirmFn("确定删除这个代理订阅吗？")) return;
    props.onDelete(subscription.id);
  };

  return (
    <section class="proxy-tab">
      <header class="proxy-tab-header">
        <div>
          <h2>代理订阅</h2>
          <p class="tagline">
            共 {filtered().length} 条 · 月价合计 {money(totalPrice())}
          </p>
        </div>
        <div class="proxy-tab-actions">
          <ProxyTagManagerDialog
            tags={props.tags}
            subscriptions={props.subscriptions}
            onRename={props.onRenameTag}
            onDelete={props.onDeleteTag}
          />
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            添加代理订阅
          </button>
        </div>
      </header>

      <div class="proxy-filters">
        <label class="proxy-field" for="proxy-status-filter">
          <span>状态</span>
          <select
            id="proxy-status-filter"
            value={props.selectedStatus}
            onChange={(event) =>
              props.onSelectedStatusChange(event.currentTarget.value)
            }
          >
            <option value="all">全部状态</option>
            <For each={statuses}>
              {(value) => <option value={value}>{statusLabels[value]}</option>}
            </For>
          </select>
        </label>
        <label class="proxy-field" for="proxy-sort">
          <span>排序</span>
          <select
            id="proxy-sort"
            value={sortKey()}
            onChange={(event) => setSortKey(event.currentTarget.value as SortKey)}
          >
            <option value="date">录入时间（新到旧）</option>
            <option value="expiration">到期日期（晚到早）</option>
            <option value="price">月价（高到低）</option>
            <option value="name">名称（A-Z）</option>
          </select>
        </label>
      </div>

      <Show when={props.error}>
        <p class="auth-error" role="alert">
          {props.error}
        </p>
      </Show>

      <Show
        when={!props.loading}
        fallback={<p class="loading">加载中...</p>}
      >
        <Show
          when={filtered().length > 0}
          fallback={<p class="proxy-empty">暂无代理订阅</p>}
        >
          <div class="proxy-grid-cards">
            <For each={filtered()}>
              {(subscription) => (
                <ProxySubscriptionCard
                  subscription={subscription}
                  tags={props.tags}
                  onEdit={() => {
                    setEditing(subscription);
                    setFormOpen(true);
                  }}
                  onDelete={() => remove(subscription)}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <ProxySubscriptionForm
        open={formOpen()}
        onOpenChange={setFormOpen}
        subscription={editing()}
        tags={props.tags}
        onSubmit={submit}
      />
    </section>
  );
};
