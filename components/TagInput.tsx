"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Tag } from "@/lib/types";
import {
  getTagNameError,
  MAX_TAGS_PER_SUBSCRIPTION,
  normalizeTagName,
} from "@/lib/tags";
import { cn } from "@/lib/utils";

interface TagInputProps {
  tags: Tag[];
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

export function TagInput({ tags, value, onChange, disabled }: TagInputProps) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const composingRef = useRef(false);

  const candidates = useMemo(() => {
    const query = input.trim().toLocaleLowerCase();
    const selected = new Set(value);
    return tags.filter(
      (tag) =>
        !selected.has(tag.name) &&
        (!query || tag.name.toLocaleLowerCase().includes(query))
    );
  }, [input, tags, value]);

  const addNames = (rawNames: string[]) => {
    const next = [...value];
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

      const existing = tags.find((tag) => tag.name === name);
      const resolvedName = existing?.name ?? name;
      selected.add(resolvedName);
      next.push(resolvedName);
    }

    onChange(next);
    setFeedback(skipped.length > 0 ? `未加入：${skipped.join("；")}` : null);
    setInput("");
    setActiveIndex(-1);
    setOpen(true);
  };

  const removeName = (name: string) => {
    onChange(value.filter((item) => item !== name));
    setFeedback(null);
  };

  const handleInputChange = (nextInput: string) => {
    if (!composingRef.current && /[,，]/.test(nextInput)) {
      const parts = nextInput.split(/[,，]/);
      addNames(parts.slice(0, -1));
      setInput(parts.at(-1) ?? "");
      return;
    }

    setInput(nextInput);
    setActiveIndex(-1);
    setOpen(true);
  };

  return (
    <div>
      <div
        className={cn(
          "relative flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-sm bg-secondary px-2 py-1 text-xs text-secondary-foreground"
          >
            <span className="break-all">{name}</span>
            <button
              type="button"
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onClick={() => removeName(name)}
              aria-label={`移除标签 ${name}`}
              title={`移除 ${name}`}
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id="subscription-tags"
          role="combobox"
          aria-expanded={open}
          aria-controls="subscription-tag-options"
          aria-autocomplete="list"
          className="h-7 min-w-[140px] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
          value={input}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            handleInputChange(event.currentTarget.value);
          }}
          onChange={(event) => handleInputChange(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!/[,，]/.test(text)) return;
            event.preventDefault();
            addNames(`${input}${text}`.split(/[,，]/));
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;

            if (event.key === "ArrowDown" && candidates.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % candidates.length);
            } else if (event.key === "ArrowUp" && candidates.length > 0) {
              event.preventDefault();
              setActiveIndex((index) =>
                index <= 0 ? candidates.length - 1 : index - 1
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (activeIndex >= 0 && candidates[activeIndex]) {
                addNames([candidates[activeIndex].name]);
              } else {
                addNames([input]);
              }
            } else if (event.key === "Backspace" && !input && value.length) {
              removeName(value[value.length - 1]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={value.length ? "继续添加" : "输入或选择标签"}
          disabled={disabled || value.length >= MAX_TAGS_PER_SUBSCRIPTION}
          autoComplete="off"
        />

        {open && !disabled && candidates.length > 0 && (
          <div
            id="subscription-tag-options"
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {candidates.map((tag, index) => (
              <button
                key={tag.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  index === activeIndex && "bg-accent text-accent-foreground"
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addNames([tag.name])}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {input.trim() && !tags.some((tag) => tag.name === input.trim()) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Plus className="h-3 w-3" />按 Enter 或逗号创建“{input.trim()}”
        </p>
      )}
      {feedback && (
        <p className="mt-1 text-xs text-destructive" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
