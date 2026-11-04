import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxySubscriptionForm } from "./ProxySubscriptionTab";

// Parity port of __tests__/ProxySubscriptionTab.test.tsx (1 case): a tag typed
// into the form is saved when the user submits without pressing Enter first.
describe("ProxySubscriptionForm", () => {
  afterEach(cleanup);

  it("saves a typed tag when the user submits without pressing Enter", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const result = render(() => (
      <ProxySubscriptionForm
        open
        onOpenChange={vi.fn()}
        subscription={null}
        tags={[]}
        onSubmit={onSubmit}
      />
    ));

    fireEvent.input(result.getByLabelText("名字"), {
      target: { value: "测试代理" },
    });
    fireEvent.click(document.querySelector("[id='proxy-expiration']")!);
    fireEvent.input(document.querySelector("[id='proxy-expiration-date']")!, {
      target: { value: "2026-12-31" },
    });
    fireEvent.input(result.getByPlaceholderText("输入或选择标签"), {
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
