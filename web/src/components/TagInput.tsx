import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { CloseIcon, DragIcon } from "./icons.tsx";
import type { Tag } from "../subscriptions/types";
import {
  getTagNameError,
  MAX_TAGS_PER_SUBSCRIPTION,
  normalizeTagName,
} from "../subscriptions/tags";

interface TagInputProps {
  tags: Tag[];
  value: string[];
  onChange: (names: string[]) => void;
  onPendingChange?: (value: string) => void;
  disabled?: boolean;
}

/**
 * TagInput ports components/TagInput.tsx: a combobox over the tag catalogue
 * with Enter/comma creation, paste batching, and a pending-text hand-off so a
 * parent form can save text the user never confirmed with Enter.
 */
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
      const name = normalizeTagName(rawName);
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
      const resolvedName = existing?.name ?? name;
      selected.add(resolvedName);
      next.push(resolvedName);
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
      const pending = parts[parts.length - 1] ?? "";
      setInput(pending);
      props.onPendingChange?.(pending);
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
              <span class="tag-chip-label">{name}</span>
              <button
                type="button"
                class="tag-chip-remove"
                onClick={() => removeName(name)}
                aria-label={`移除标签 ${name}`}
                title={`移除 ${name}`}
                disabled={props.disabled}
              >
                <CloseIcon />
              </button>
            </span>
          )}
        </For>
        <input
          id="subscription-tags"
          role="combobox"
          aria-expanded={open()}
          aria-controls="subscription-tag-options"
          aria-autocomplete="list"
          class="tag-input-field"
          value={input()}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onInput={(event) => handleInput(event.currentTarget.value)}
          onPaste={(event) => {
            const text = event.clipboardData?.getData("text") ?? "";
            if (!/[,，]/.test(text)) return;
            event.preventDefault();
            addNames(`${input()}${text}`.split(/[,，]/));
          }}
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
              if (activeIndex() >= 0 && active) {
                addNames([active.name]);
              } else {
                addNames([input()]);
              }
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
          placeholder={props.value.length ? "继续添加" : "输入或选择标签"}
          disabled={
            props.disabled || props.value.length >= MAX_TAGS_PER_SUBSCRIPTION
          }
          autocomplete="off"
        />

        <Show when={open() && !props.disabled && candidates().length > 0}>
          <div
            id="subscription-tag-options"
            role="listbox"
            class="tag-input-options"
          >
            <For each={candidates()}>
              {(tag, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index() === activeIndex()}
                  class="tag-option"
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
