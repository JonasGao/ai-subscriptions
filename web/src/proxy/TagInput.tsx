import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { CloseIcon, DragIcon } from "../components/icons.tsx";

// TagInput is the SolidJS port of components/TagInput.tsx, trimmed to what the
// proxy subscription form needs: pick existing tags, type a new one, comma
// separates entries. It reports the pending (not-yet-committed) text so the
// surrounding form can save it on submit without requiring Enter first — the
// behaviour __tests__/ProxySubscriptionTab.test.tsx locks.

export const MAX_TAG_NAME_LENGTH = 30;
export const MAX_TAGS_PER_SUBSCRIPTION = 20;

/** getTagNameError mirrors lib/tags.ts. */
export function getTagNameError(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "标签不能为空";
  if (/[,，\r\n]/.test(normalized)) return "标签不能包含中英文逗号或换行";
  if (Array.from(normalized).length > MAX_TAG_NAME_LENGTH) {
    return `标签不能超过 ${MAX_TAG_NAME_LENGTH} 个字符`;
  }
  return null;
}

interface TagInputProps {
  tags: { id: string; name: string }[];
  value: string[];
  onChange: (names: string[]) => void;
  onPendingChange?: (value: string) => void;
  disabled?: boolean;
}

export const TagInput: Component<TagInputProps> = (props) => {
  const [input, setInput] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const [feedback, setFeedback] = createSignal<string | null>(null);

  const candidates = createMemo(() => {
    const query = input().trim().toLocaleLowerCase();
    const selected = new Set(props.value);
    return props.tags.filter(
      (tag) =>
        !selected.has(tag.name) &&
        (!query || tag.name.toLocaleLowerCase().includes(query))
    );
  });

  const addNames = (rawNames: string[]) => {
    const next = [...props.value];
    const selected = new Set(next);
    const skipped: string[] = [];

    for (const rawName of rawNames) {
      const name = rawName.trim();
      if (!name) continue;
      const error = getTagNameError(name);
      if (error) {
        skipped.push(`「${name}」${error.replace("标签", "")}`);
        continue;
      }
      if (selected.has(name)) continue;
      if (next.length >= MAX_TAGS_PER_SUBSCRIPTION) {
        skipped.push(`「${name}」超过 ${MAX_TAGS_PER_SUBSCRIPTION} 个上限`);
        continue;
      }
      const existing = props.tags.find((tag) => tag.name === name);
      const resolved = existing?.name ?? name;
      selected.add(resolved);
      next.push(resolved);
    }

    props.onChange(next);
    setFeedback(skipped.length > 0 ? `未加入：${skipped.join("；")}` : null);
    setInput("");
    props.onPendingChange?.("");
    setActiveIndex(-1);
    setOpen(true);
  };

  const removeName = (name: string) => {
    props.onChange(props.value.filter((item) => item !== name));
    setFeedback(null);
  };

  const handleInput = (nextInput: string) => {
    if (/[,，]/.test(nextInput)) {
      const parts = nextInput.split(/[,，]/);
      addNames(parts.slice(0, -1));
      setInput(parts.at(-1) ?? "");
      props.onPendingChange?.(parts.at(-1) ?? "");
      return;
    }
    setInput(nextInput);
    props.onPendingChange?.(nextInput);
    setActiveIndex(-1);
    setOpen(true);
  };

  return (
    <div class="tag-input">
      <div class="tag-input-box">
        <For each={props.value}>
          {(name) => (
            <span class="tag-chip">
              <span>{name}</span>
              <button
                type="button"
                aria-label={`移除标签 ${name}`}
                title={`移除 ${name}`}
                disabled={props.disabled}
                onClick={() => removeName(name)}
              >
                <CloseIcon />
              </button>
            </span>
          )}
        </For>
        <input
          id="proxy-tags"
          role="combobox"
          aria-expanded={open()}
          aria-controls="proxy-tag-options"
          aria-autocomplete="list"
          class="tag-input-field"
          value={input()}
          placeholder={props.value.length ? "继续添加" : "输入或选择标签"}
          disabled={
            props.disabled || props.value.length >= MAX_TAGS_PER_SUBSCRIPTION
          }
          autocomplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onInput={(event) => handleInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.isComposing) return;
            if (event.key === "ArrowDown" && candidates().length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % candidates().length);
            } else if (event.key === "ArrowUp" && candidates().length > 0) {
              event.preventDefault();
              setActiveIndex((index) =>
                index <= 0 ? candidates().length - 1 : index - 1
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              const active = candidates()[activeIndex()];
              addNames([active ? active.name : input()]);
            } else if (
              event.key === "Backspace" &&
              !input() &&
              props.value.length
            ) {
              removeName(props.value[props.value.length - 1]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />

        <Show when={open() && !props.disabled && candidates().length > 0}>
          <div id="proxy-tag-options" role="listbox" class="tag-input-options">
            <For each={candidates()}>
              {(tag, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index() === activeIndex()}
                  class="tag-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addNames([tag.name])}
                >
                  {tag.name}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show
        when={
          input().trim() &&
          !props.tags.some((tag) => tag.name === input().trim())
        }
      >
        <p class="tag-hint">按 Enter 或逗号创建“{input().trim()}”</p>
      </Show>
      <Show when={feedback()}>
        <p class="tag-feedback" role="status">
          {feedback()}
        </p>
      </Show>
    </div>
  );
};
