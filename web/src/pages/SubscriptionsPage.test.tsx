// Page-level flow for ticket #26: the list renders real API data, and
// create → pause → delete round-trips through the subscription routes.

import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "../test-utils";
import type { Subscription } from "../subscriptions/types";

const activeSession = {
  body: {
    user: {
      id: "1",
      username: "admin",
      name: "admin",
      email: "admin@local",
      isInitial: false,
    },
  },
};

const tagStable = {
  id: "tag-1",
  name: "稳定",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Kimi Code",
    category: "官方订阅",
    provider: "moonshot",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    planId: "kimi-code",
    tagIds: ["tag-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseStubs(subs: Subscription[]) {
  return {
    "GET /api/auth/session": activeSession,
    "GET /api/subscriptions": { body: subs },
    "GET /api/categories": { body: ["官方订阅", "中转站"] },
    "GET /api/tags": { body: [tagStable] },
    "GET /api/providers": {
      body: [{ id: "moonshot", name: "月之暗面", plans: [{ id: "kimi-code", name: "Kimi Code" }] }],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("订阅列表页", () => {
  it("renders subscriptions and their tags from the API", async () => {
    stubFetch(baseStubs([subscription()]));
    renderAt("/subscriptions");

    expect(await screen.findByRole("heading", { name: "Kimi Code" })).toBeTruthy();
    expect(await screen.findByText("月之暗面")).toBeTruthy();
    expect(screen.getByText("稳定")).toBeTruthy();
    expect(screen.getByText("¥20.00/月")).toBeTruthy();
  });

  it("creates a subscription and reuses an existing tag id", async () => {
    const created = subscription({
      id: "sub-new",
      name: "新订阅",
      subscriptionType: "one-time",
      planId: undefined,
      price: 50,
      tagIds: ["tag-1"],
    });
    const fetchMock = stubFetch({
      ...baseStubs([]),
      "POST /api/subscriptions": { status: 201, body: created },
    });

    renderAt("/subscriptions");
    fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));

    fireEvent.input(screen.getByPlaceholderText("输入订阅名称"), {
      target: { value: "新订阅" },
    });
    fireEvent.change(screen.getByLabelText("订阅类型 *"), {
      target: { value: "one-time" },
    });
    fireEvent.input(screen.getByLabelText(/充值金额/), {
      target: { value: "50" },
    });
    const tagInput = screen.getByPlaceholderText("输入或选择标签");
    fireEvent.input(tagInput, { target: { value: "稳定" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    fireEvent.submit(document.querySelector("form")!);

    expect(await screen.findByRole("heading", { name: "新订阅" })).toBeTruthy();

    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/subscriptions") && init?.method === "POST"
    );
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      name: "新订阅",
      subscriptionType: "one-time",
      price: 50,
      category: "官方订阅",
      tagNames: ["稳定"],
    });
  });

  it("pauses an active subscription through the status route", async () => {
    const fetchMock = stubFetch({
      ...baseStubs([subscription()]),
      "PUT /api/subscriptions/sub-1": { body: subscription({ status: "paused" }) },
    });

    renderAt("/subscriptions");
    fireEvent.click(await screen.findByRole("button", { name: "活跃" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/api/subscriptions/sub-1") &&
          init?.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: "paused" });
    });
    expect(await screen.findByRole("button", { name: "暂停" })).toBeTruthy();
  });

  it("deletes a subscription after two confirmations", async () => {
    const fetchMock = stubFetch({
      ...baseStubs([subscription()]),
      "DELETE /api/subscriptions/sub-1": { body: { success: true } },
    });

    renderAt("/subscriptions");
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "继续删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/subscriptions/sub-1") &&
            init?.method === "DELETE"
        )
      ).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Kimi Code" })).toBeNull()
    );
  });
});
