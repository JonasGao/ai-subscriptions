// Reset-schedule card config UI (#27): the two creation methods (offset /
// direct), type uniqueness, enable switch and removal. These are new-stack
// cases (the old stack had no component tests for ResetScheduleConfig).

import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetScheduleConfig } from "./ResetScheduleConfig";
import type { ResetSchedule } from "../subscriptions/types";

const NOW = new Date("2024-06-03T00:00:00.000Z"); // Monday

function makeSchedule(overrides: Partial<ResetSchedule> = {}): ResetSchedule {
  return {
    id: "sched-1",
    enabled: true,
    type: "fiveHour",
    nextResetTime: "2024-06-03T05:00:00.000Z",
    exhausted: false,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderConfig(schedules: ResetSchedule[] = []) {
  const onChange = vi.fn();
  const result = render(() => (
    <ResetScheduleConfig
      schedules={schedules}
      onChange={onChange}
      timezone="UTC"
    />
  ));
  return { onChange, result };
}

describe("ResetScheduleConfig", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("creates a schedule from an offset and infers the weekday", () => {
    const { onChange, result } = renderConfig();

    fireEvent.click(result.getByRole("button", { name: /添加/ }));
    fireEvent.change(result.getByLabelText("类型"), {
      target: { value: "weekly" },
    });
    fireEvent.input(result.getByLabelText("持续时间"), {
      target: { value: "3d 5h" },
    });
    fireEvent.click(result.getByRole("button", { name: "确定" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [schedules] = onChange.mock.calls[0];
    expect(schedules).toHaveLength(1);
    const [schedule] = schedules;
    expect(schedule.type).toBe("weekly");
    expect(schedule.dayOfWeek).toBe(4); // Thursday
    expect(schedule.timeOfDay).toBe("05:00");
    expect(schedule.timezone).toBe("UTC");
    expect(schedule.nextResetTime).toBe("2024-06-06T05:00:00.000Z");
    expect(schedule.enabled).toBe(true);
    expect(schedule.exhausted).toBe(false);
  });

  it("creates a schedule from direct input", () => {
    const { onChange, result } = renderConfig();

    fireEvent.click(result.getByRole("button", { name: /添加/ }));
    fireEvent.change(result.getByLabelText("类型"), {
      target: { value: "monthly" },
    });
    fireEvent.change(result.getByLabelText("输入方式"), {
      target: { value: "direct" },
    });
    fireEvent.change(result.getByLabelText("日期"), {
      target: { value: "15" },
    });
    fireEvent.input(result.getByLabelText("时间"), {
      target: { value: "10:00" },
    });
    fireEvent.click(result.getByRole("button", { name: "确定" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [schedule] = onChange.mock.calls[0][0];
    expect(schedule.type).toBe("monthly");
    expect(schedule.dayOfMonth).toBe(15);
    expect(schedule.timeOfDay).toBe("10:00");
    expect(schedule.nextResetTime).toBe("2024-06-15T10:00:00.000Z");
  });

  it("shows the inferred pattern preview after the 500ms debounce", () => {
    const { result } = renderConfig();

    fireEvent.click(result.getByRole("button", { name: /添加/ }));
    fireEvent.change(result.getByLabelText("类型"), {
      target: { value: "weekly" },
    });
    fireEvent.input(result.getByLabelText("持续时间"), {
      target: { value: "3d 5h" },
    });

    expect(result.queryByText(/将持续在/)).toBeNull();
    vi.advanceTimersByTime(500);
    expect(result.getByText("将持续在 每周周四 05:00 重置 (UTC)")).toBeTruthy();
  });

  it("reports malformed offsets instead of creating a schedule", () => {
    const { onChange, result } = renderConfig();

    fireEvent.click(result.getByRole("button", { name: /添加/ }));
    fireEvent.input(result.getByLabelText("持续时间"), {
      target: { value: "soon" },
    });
    fireEvent.click(result.getByRole("button", { name: "确定" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(result.getByText("格式错误，请使用如：3d 5h 44m")).toBeTruthy();
  });

  it("disables a type the subscription already uses", () => {
    const { result } = renderConfig([makeSchedule({ type: "fiveHour" })]);

    fireEvent.click(result.getByRole("button", { name: /添加/ }));
    const option = result.getByRole("option", {
      name: "每5小时",
    }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it("hides the add affordance once all three types exist", () => {
    const { result } = renderConfig([
      makeSchedule({ id: "a", type: "fiveHour" }),
      makeSchedule({ id: "b", type: "weekly" }),
      makeSchedule({ id: "c", type: "monthly" }),
    ]);

    expect(result.queryByRole("button", { name: /添加/ })).toBeNull();
  });

  it("toggles the enabled switch and removes a schedule", () => {
    const { onChange, result } = renderConfig([makeSchedule()]);

    fireEvent.click(result.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "sched-1", enabled: false }),
    ]);

    onChange.mockClear();
    fireEvent.click(result.getByRole("button", { name: "删除计划" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("switches an offset form to direct input and pre-fills the inferred values", () => {
    const { result } = renderConfig();

    fireEvent.click(result.getByRole("button", { name: /添加/ }));
    fireEvent.change(result.getByLabelText("类型"), {
      target: { value: "weekly" },
    });
    fireEvent.input(result.getByLabelText("持续时间"), {
      target: { value: "3d 5h" },
    });
    fireEvent.change(result.getByLabelText("输入方式"), {
      target: { value: "direct" },
    });

    expect((result.getByLabelText("星期") as HTMLSelectElement).value).toBe(
      "4"
    );
    expect((result.getByLabelText("时间") as HTMLInputElement).value).toBe(
      "05:00"
    );
  });
});

// ADR-0002: the schedule config is only rendered for recurring subscriptions,
// but the form keeps the schedules in state across a type switch. The
// SubscriptionForm owns that gate; these cases pin the two halves.
describe("ResetScheduleConfig recurring-only gate (ADR-0002)", () => {
  it("renders one-time subscriptions without a schedule section", async () => {
    const { SubscriptionForm } = await import("./SubscriptionForm");
    const result = render(() => (
      <SubscriptionForm
        open
        onOpenChange={() => {}}
        subscription={null}
        categories={["官方订阅"]}
        tags={[]}
        providers={[{ id: "openai", name: "OpenAI" }]}
        onSubmit={() => true}
      />
    ));

    expect(result.queryByText("额度重置计划")).toBeTruthy();
    fireEvent.change(result.getByLabelText("订阅类型 *"), {
      target: { value: "one-time" },
    });
    expect(result.queryByText("额度重置计划")).toBeNull();
    fireEvent.change(result.getByLabelText("订阅类型 *"), {
      target: { value: "recurring" },
    });
    expect(result.queryByText("额度重置计划")).toBeTruthy();
  });
});
