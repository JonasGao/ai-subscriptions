// Final-parity coverage for the provider credential area the rewritten form
// had dropped: credential fields render for query-capable providers, editing a
// subscription without stored credentials auto-expands the section, the "test
// connection" button posts the old payload to /api/test-connection, and typed
// credentials are included in the form submission.

import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionForm } from "./SubscriptionForm";
import type { Provider, Subscription } from "../subscriptions/types";

const providers: Provider[] = [
  {
    id: "moonshot",
    name: "月之暗面",
    balanceApiUrl: "https://api.moonshot.cn/v1/users/me/balance",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
    plans: [
      {
        id: "kimi-code",
        name: "Kimi Code",
        usageApiUrl: "https://api.kimi.com/coding/v1/usages",
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
  },
];

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Kimi Code",
    category: "官方订阅",
    provider: "moonshot",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 100,
    startDate: "2026-01-01",
    renewalDate: "2026-02-01",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderForm(subscription?: Subscription) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const result = render(() => (
    <SubscriptionForm
      open
      onOpenChange={vi.fn()}
      subscription={subscription}
      categories={["官方订阅"]}
      tags={[]}
      providers={providers}
      onSubmit={onSubmit}
    />
  ));
  return { onSubmit, result };
}

describe("SubscriptionForm credentials", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("auto-expands credential fields when editing without stored credentials", () => {
    const { result } = renderForm(makeSubscription({ hasCredentials: false }));

    expect(result.getByLabelText("API Key")).toBeTruthy();
    expect(result.getByRole("button", { name: /认证凭据/ })).toBeTruthy();
  });

  it("collapses stored credentials and reveals them on toggle", () => {
    const { result } = renderForm(makeSubscription({ hasCredentials: true }));

    expect(result.queryByLabelText("API Key")).toBeNull();
    expect(result.getByText("已配置")).toBeTruthy();

    fireEvent.click(result.getByRole("button", { name: /认证凭据/ }));

    expect(result.getByLabelText("API Key")).toBeTruthy();
    expect(
      (result.getByLabelText("API Key") as HTMLInputElement).placeholder
    ).toBe("已配置，留空保持不变");
  });

  it("posts the plan-aware payload to /api/test-connection and shows the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: "连接成功" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderForm(makeSubscription());
    fireEvent.input(result.getByLabelText("API Key"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(result.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(result.getByText("连接成功")).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/test-connection");
    expect(JSON.parse(init.body)).toEqual({
      provider: "moonshot",
      planId: "kimi-code",
      credentials: { apiKey: "sk-test" },
    });
  });

  it("includes typed credentials in the submitted form data", async () => {
    const { onSubmit, result } = renderForm(makeSubscription());

    fireEvent.input(result.getByLabelText("名称 *"), {
      target: { value: "新订阅" },
    });
    fireEvent.input(result.getByLabelText("API Key"), {
      target: { value: "sk-typed" },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { apiKey: "sk-typed" },
        })
      );
    });
  });

  it("hides the section for providers without a query endpoint", () => {
    const { result } = renderForm(makeSubscription({ provider: "anthropic" }));

    expect(result.queryByRole("button", { name: /认证凭据/ })).toBeNull();
  });
});
