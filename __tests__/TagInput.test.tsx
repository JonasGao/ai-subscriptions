// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagInput } from "@/components/TagInput";
import { SubscriptionForm } from "@/components/SubscriptionForm";
import { Tag } from "@/lib/types";

const tags: Tag[] = [
  {
    id: "tag-new",
    name: "High Quality",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "tag-old",
    name: "稳定",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("TagInput", () => {
  afterEach(cleanup);

  it("shows historical tags and selects one by click", () => {
    const onChange = vi.fn();
    const result = render(
      <TagInput tags={tags} value={[]} onChange={onChange} />
    );

    fireEvent.focus(result.getByRole("combobox"));
    fireEvent.click(result.getByRole("option", { name: "稳定" }));

    expect(onChange).toHaveBeenCalledWith(["稳定"]);
  });

  it("searches without case sensitivity and reuses exact names", () => {
    const onChange = vi.fn();
    const result = render(
      <TagInput tags={tags} value={[]} onChange={onChange} />
    );
    const input = result.getByRole("combobox");

    fireEvent.change(input, { target: { value: "high" } });
    expect(result.getByRole("option", { name: "High Quality" })).toBeTruthy();

    fireEvent.change(input, { target: { value: "High Quality" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["High Quality"]);
  });

  it("creates with Enter and accepts Chinese and ASCII comma batches", () => {
    const onChange = vi.fn();
    const result = render(
      <TagInput tags={tags} value={[]} onChange={onChange} />
    );
    const input = result.getByRole("combobox");

    fireEvent.change(input, { target: { value: "New Tag" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["New Tag"]);

    result.rerender(
      <TagInput tags={tags} value={["New Tag"]} onChange={onChange} />
    );
    fireEvent.paste(input, {
      clipboardData: { getData: () => "便宜,快速，推荐" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      "New Tag",
      "便宜",
      "快速",
      "推荐",
    ]);
  });

  it("reports uncommitted text so a parent form can save it", () => {
    const onPendingChange = vi.fn();
    const result = render(
      <TagInput
        tags={tags}
        value={[]}
        onChange={vi.fn()}
        onPendingChange={onPendingChange}
      />
    );

    fireEvent.change(result.getByRole("combobox"), {
      target: { value: "直接保存" },
    });

    expect(onPendingChange).toHaveBeenLastCalledWith("直接保存");
  });

  it("lets the subscription form save text that was not confirmed with Enter", () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as typeof fetch;

    try {
      const result = render(
        <SubscriptionForm
          open
          onOpenChange={vi.fn()}
          subscriptions={[]}
          categories={["AI助手"]}
          tags={[]}
          onSubmit={onSubmit}
          onRenameTag={vi.fn()}
          onDeleteTag={vi.fn()}
        />
      );
      const input = result.getByPlaceholderText("输入或选择标签");
      fireEvent.change(input, { target: { value: "直接保存" } });
      fireEvent.submit(document.querySelector("form")!);

      return waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ tagNames: ["直接保存"] })
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips overlong pasted tags and reports them", () => {
    const onChange = vi.fn();
    const result = render(
      <TagInput tags={tags} value={[]} onChange={onChange} />
    );
    const input = result.getByRole("combobox");
    const overlong = "x".repeat(31);

    fireEvent.paste(input, {
      clipboardData: { getData: () => `有效,${overlong}` },
    });

    expect(onChange).toHaveBeenLastCalledWith(["有效"]);
    expect(result.getByRole("status").textContent).toContain(
      "不能超过 30 个字符"
    );
  });
});
