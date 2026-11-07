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
      body: [
        {
          id: "moonshot",
          name: "月之暗面",
          plans: [{ id: "kimi-code", name: "Kimi Code" }],
        },
      ],
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

    expect(
      await screen.findByRole("heading", { name: "Kimi Code" })
    ).toBeTruthy();
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
      "PUT /api/subscriptions/sub-1": {
        body: subscription({ status: "paused" }),
      },
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

describe("订阅列表页收尾（#40）", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("restores and persists the category and status filters", async () => {
    window.localStorage.setItem("selectedCategory", "中转站");
    window.localStorage.setItem("selectedStatuses", JSON.stringify(["paused"]));
    stubFetch(
      baseStubs([
        subscription({
          id: "hidden-cat",
          name: "分类不符",
          category: "官方订阅",
        }),
        subscription({
          id: "hidden-status",
          name: "状态不符",
          category: "中转站",
        }),
        subscription({
          id: "shown",
          name: "命中筛选",
          category: "中转站",
          status: "paused",
        }),
      ])
    );

    renderAt("/subscriptions");

    expect(
      await screen.findByRole("heading", { name: "命中筛选" })
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "分类不符" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "状态不符" })).toBeNull();
    expect((screen.getByLabelText("分类筛选") as HTMLSelectElement).value).toBe(
      "中转站"
    );
    expect(
      (screen.getByRole("checkbox", { name: "暂停" }) as HTMLInputElement)
        .checked
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("分类筛选"), {
      target: { value: "all" },
    });
    expect(window.localStorage.getItem("selectedCategory")).toBe("all");

    fireEvent.click(screen.getByRole("checkbox", { name: "暂停" }));
    expect(
      JSON.parse(window.localStorage.getItem("selectedStatuses") ?? "null")
    ).toEqual([]);
  });

  it("filters rows by the title-row search box (name or provider)", async () => {
    stubFetch(
      baseStubs([
        subscription({ id: "a", name: "Kimi Code", provider: "moonshot" }),
        subscription({ id: "b", name: "Claude Pro", provider: "openai" }),
      ])
    );

    renderAt("/subscriptions");

    expect(
      await screen.findByRole("heading", { name: "Kimi Code" })
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Claude Pro" })).toBeTruthy();

    fireEvent.input(screen.getByLabelText("搜索订阅"), {
      target: { value: "kimi" },
    });
    expect(screen.getByRole("heading", { name: "Kimi Code" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Claude Pro" })).toBeNull();

    fireEvent.input(screen.getByLabelText("搜索订阅"), {
      target: { value: "OpenAI" },
    });
    expect(screen.queryByRole("heading", { name: "Kimi Code" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Claude Pro" })).toBeTruthy();

    fireEvent.input(screen.getByLabelText("搜索订阅"), {
      target: { value: "" },
    });
    expect(screen.getByRole("heading", { name: "Kimi Code" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Claude Pro" })).toBeTruthy();
  });

  it("tells a filtered-out list apart from an empty ledger and recovers", async () => {
    stubFetch(baseStubs([subscription({ id: "a", name: "Kimi Code" })]));

    renderAt("/subscriptions");

    expect(
      await screen.findByRole("heading", { name: "Kimi Code" })
    ).toBeTruthy();

    // A search with no matches is a filter problem, not missing data.
    fireEvent.input(screen.getByLabelText("搜索订阅"), {
      target: { value: "不存在的服务" },
    });
    expect(screen.getByText("没有符合条件的订阅。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "清除筛选" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Kimi Code" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(
      await screen.findByRole("heading", { name: "Kimi Code" })
    ).toBeTruthy();
  });

  it("shows stats for the filtered set and the shared page shell", async () => {
    stubFetch(
      baseStubs([
        subscription({ id: "m", name: "月度订阅", price: 20 }),
        subscription({
          id: "t",
          name: "一次性订阅",
          subscriptionType: "one-time",
          price: 0,
          balance: 50,
        }),
      ])
    );

    renderAt("/subscriptions");

    expect(
      await screen.findByRole("heading", { name: "月度订阅" })
    ).toBeTruthy();
    expect(screen.getByText("¥20.00/月")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "订阅" }).getAttribute("aria-current")
    ).toBe("page");
    expect(screen.getByText("月度总支出")).toBeTruthy();
    expect(screen.getByText("¥20.00")).toBeTruthy();
    // One-time subscriptions carry price 0; the stat sums balance (#3195007).
    expect(
      screen.getByText("一次性充值").closest("article")?.textContent
    ).toContain("¥50.00");
  });
});
