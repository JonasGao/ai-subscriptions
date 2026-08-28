// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortablePriorityList } from "@/components/SortablePriorityList";
import { ResetSchedule, Subscription } from "@/lib/types";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

function makeSubscription(
  id: string,
  name: string,
  overrides?: Partial<Subscription>
): Subscription {
  return {
    id,
    name,
    category: "AI助手",
    provider: "openai",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSchedule(
  id: string,
  type: ResetSchedule["type"],
  overrides?: Partial<ResetSchedule>
): ResetSchedule {
  return {
    id,
    type,
    enabled: true,
    exhausted: false,
    nextResetTime: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function getPriorityRow(container: HTMLElement, name: string): HTMLElement {
  const nameElement = within(container).getByText(name);
  const row = nameElement.closest<HTMLElement>("[data-priority-rank]");

  if (!row) {
    throw new Error(`No priority row found for ${name}`);
  }

  return row;
}

describe("SortablePriorityList priority indicators", () => {
  afterEach(cleanup);

  it("numbers visible subscriptions continuously and spans the full color range", () => {
    const subscriptions = [
      makeSubscription("alpha", "Alpha"),
      makeSubscription("beta", "Beta"),
      makeSubscription("gamma", "Gamma"),
    ];
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["alpha", "missing", "beta", "gamma"]}
        subscriptions={subscriptions}
        onRemove={vi.fn()}
      />
    );

    const alpha = getPriorityRow(result.container, "Alpha");
    const beta = getPriorityRow(result.container, "Beta");
    const gamma = getPriorityRow(result.container, "Gamma");

    expect(alpha.dataset.priorityRank).toBe("1");
    expect(beta.dataset.priorityRank).toBe("2");
    expect(gamma.dataset.priorityRank).toBe("3");
    expect(within(alpha).getByLabelText("优先级 1").textContent).toBe("1");
    expect(within(beta).getByLabelText("优先级 2").textContent).toBe("2");
    expect(within(gamma).getByLabelText("优先级 3").textContent).toBe("3");
    expect(alpha.style.getPropertyValue("--priority-bg-opacity-light")).toBe(
      "0.18"
    );
    expect(gamma.style.getPropertyValue("--priority-bg-opacity-light")).toBe(
      "0.05"
    );
  });

  it("uses the highest-priority color for a one-item scene", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["alpha"]}
        subscriptions={[makeSubscription("alpha", "Alpha")]}
        onRemove={vi.fn()}
      />
    );

    const alpha = getPriorityRow(result.container, "Alpha");
    expect(alpha.dataset.priorityRank).toBe("1");
    expect(alpha.style.getPropertyValue("--priority-bg-opacity-light")).toBe(
      "0.18"
    );
  });

  it("moves the rank and color with a subscription after reordering", () => {
    const subscriptions = [
      makeSubscription("alpha", "Alpha"),
      makeSubscription("beta", "Beta"),
      makeSubscription("gamma", "Gamma"),
    ];
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["alpha", "beta", "gamma"]}
        subscriptions={subscriptions}
        onRemove={vi.fn()}
      />
    );

    result.rerender(
      <SortablePriorityList
        subscriptionOrder={["gamma", "alpha", "beta"]}
        subscriptions={subscriptions}
        onRemove={vi.fn()}
      />
    );

    const gamma = getPriorityRow(result.container, "Gamma");
    const beta = getPriorityRow(result.container, "Beta");
    expect(gamma.dataset.priorityRank).toBe("1");
    expect(gamma.style.getPropertyValue("--priority-bg-opacity-dark")).toBe(
      "0.26"
    );
    expect(beta.dataset.priorityRank).toBe("3");
    expect(beta.style.getPropertyValue("--priority-bg-opacity-dark")).toBe(
      "0.08"
    );
  });
});

describe("SortablePriorityList exhausted scope labels", () => {
  afterEach(cleanup);

  it("does not render a scope label when no resetSchedules exist", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[makeSubscription("a", "Alpha")]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).queryByText("5小时")).toBeNull();
    expect(within(row).queryByText("周")).toBeNull();
    expect(within(row).queryByText("月度")).toBeNull();
  });

  it("does not render a scope label when schedules exist but none are exhausted", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [
              makeSchedule("s1", "fiveHour"),
              makeSchedule("s2", "weekly"),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).queryByText("5小时")).toBeNull();
    expect(within(row).queryByText("周")).toBeNull();
    expect(within(row).queryByText("月度")).toBeNull();
  });

  it("does not render a scope label when exhausted schedule is disabled", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [
              makeSchedule("s1", "fiveHour", {
                enabled: false,
                exhausted: true,
              }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).queryByText("5小时")).toBeNull();
  });

  it("renders the matching scope label when a single schedule is exhausted", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [makeSchedule("s1", "weekly", { exhausted: true })],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).getByText("周")).toBeTruthy();
    expect(within(row).queryByText("5小时")).toBeNull();
    expect(within(row).queryByText("月度")).toBeNull();
  });

  it("renders the largest scope when multiple schedules are exhausted (monthly > weekly > fiveHour)", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [
              makeSchedule("s1", "fiveHour", { exhausted: true }),
              makeSchedule("s2", "weekly", { exhausted: true }),
              makeSchedule("s3", "monthly", { exhausted: true }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).getByText("月度")).toBeTruthy();
    expect(within(row).queryByText("周")).toBeNull();
    expect(within(row).queryByText("5小时")).toBeNull();
  });

  it("picks weekly over fiveHour when both are exhausted", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [
              makeSchedule("s1", "fiveHour", { exhausted: true }),
              makeSchedule("s2", "weekly", { exhausted: true }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).getByText("周")).toBeTruthy();
    expect(within(row).queryByText("5小时")).toBeNull();
  });

  it("does not render a scope label for cancelled subscriptions", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            status: "cancelled",
            resetSchedules: [
              makeSchedule("s1", "monthly", { exhausted: true }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).queryByText("月度")).toBeNull();
    expect(within(row).queryByText("周")).toBeNull();
    expect(within(row).queryByText("5小时")).toBeNull();
  });

  it("does not render a scope label for paused subscription without exhausted schedules", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            status: "paused",
            resetSchedules: [
              makeSchedule("s1", "fiveHour", { exhausted: false }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    expect(within(row).queryByText("5小时")).toBeNull();
  });

  it("renders the scope label with red styling", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [
              makeSchedule("s1", "fiveHour", { exhausted: true }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    const label = within(row).getByText("5小时");
    expect(label.className).toMatch(/text-red-500/);
  });

  it("places the scope label before the status badge", () => {
    const result = render(
      <SortablePriorityList
        subscriptionOrder={["a"]}
        subscriptions={[
          makeSubscription("a", "Alpha", {
            resetSchedules: [
              makeSchedule("s1", "monthly", { exhausted: true }),
            ],
          }),
        ]}
        onRemove={vi.fn()}
      />
    );
    const row = getPriorityRow(result.container, "Alpha");
    const scopeLabel = within(row).getByText("月度");
    const statusBadge = within(row).getByText("活跃");
    expect(
      scopeLabel.compareDocumentPosition(statusBadge) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
