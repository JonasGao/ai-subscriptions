// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxySubscriptionForm } from "@/components/ProxySubscriptionTab";

describe("ProxySubscriptionForm", () => {
  afterEach(cleanup);

  it("saves a typed tag when the user submits without pressing Enter", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const onSubmit = vi.fn().mockResolvedValue(true);
    const result = render(
      <ProxySubscriptionForm
        open
        onOpenChange={vi.fn()}
        subscription={null}
        tags={[]}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(result.getByLabelText("名字"), {
      target: { value: "测试代理" },
    });
    fireEvent.click(document.querySelector("[id='proxy-expiration']")!);
    fireEvent.change(document.querySelector("[id='proxy-expiration-date']")!, {
      target: { value: "2026-12-31" },
    });
    fireEvent.change(result.getByPlaceholderText("输入或选择标签"), {
      target: { value: "直接保存" },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ tagNames: ["直接保存"] })
      );
    });
  });
});
