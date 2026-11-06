// Page-level coverage for the tool catalog (#35): tool add/edit/delete and the
// status cycle, plus the wiring to /api/tools. Drag reordering is exercised in
// the browser demo.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsPage } from "./ToolsPage";
import { stubFetch } from "../test-utils";

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    id: "tool-1",
    name: "Cursor",
    category: "官方订阅",
    provider: "anthropic",
    forms: ["GUI"],
    order: 1,
    isOpenSource: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseRoutes(extra: Record<string, unknown> = {}) {
  return {
    "GET /api/tools": { body: [makeTool()] },
    "GET /api/categories": { body: ["官方订阅", "中转站"] },
    "GET /api/providers": { body: [{ id: "anthropic", name: "Anthropic" }] },
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ToolsPage", () => {
  it("renders the tool catalog from the API", async () => {
    stubFetch(baseRoutes());
    render(() => <ToolsPage />);

    await waitFor(() => expect(screen.getByText("Cursor")).toBeTruthy());
    expect(screen.getByText("分类: 官方订阅")).toBeTruthy();
  });

  it("creates a tool through the form", async () => {
    const fetchMock = stubFetch(
      baseRoutes({
        "POST /api/tools": {
          status: 201,
          body: makeTool({ id: "tool-2", name: "Claude Code", order: 2 }),
        },
      })
    );
    render(() => <ToolsPage />);
    await waitFor(() => expect(screen.getByText("Cursor")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "添加工具" }));
    fireEvent.input(screen.getByPlaceholderText("输入工具名称"), {
      target: { value: " Claude Code " },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Claude Code")).toBeTruthy());
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.name).toBe("Claude Code");
    expect(body.category).toBe("官方订阅");
  });

  it("updates an existing tool through the edit form", async () => {
    const fetchMock = stubFetch(
      baseRoutes({
        "PUT /api/tools/tool-1": { body: makeTool({ name: "Cursor Pro" }) },
      })
    );
    render(() => <ToolsPage />);
    await waitFor(() => expect(screen.getByText("Cursor")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.input(screen.getByPlaceholderText("输入工具名称"), {
      target: { value: "Cursor Pro" },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Cursor Pro")).toBeTruthy());
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT"
    );
    expect(call?.[0]).toBe("/api/tools/tool-1");
  });

  it("deletes a tool after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubFetch(
      baseRoutes({ "DELETE /api/tools/tool-1": { body: { success: true } } })
    );
    render(() => <ToolsPage />);
    await waitFor(() => expect(screen.getByText("Cursor")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(screen.queryByText("Cursor")).toBeNull());
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE"
      )
    ).toBe(true);
  });

  it("cycles the tool status", async () => {
    const fetchMock = stubFetch(
      baseRoutes({
        "PUT /api/tools/tool-1": { body: makeTool({ status: "paused" }) },
      })
    );
    render(() => <ToolsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "活跃" })).toBeTruthy()
    );

    fireEvent.click(screen.getByRole("button", { name: "活跃" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy()
    );
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT"
    );
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.status).toBe("paused");
  });
});
