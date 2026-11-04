// Priority-scene persistence (#35): adding an item and removing one both
// persist through PATCH {action:"reorder"}, which is what the old
// usePriorityScenes hook sent after every drag.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { For } from "solid-js";
import { PriorityScenes } from "./PriorityScenes";
import { toolPriorityScenes } from "./api";
import { stubFetch } from "../test-utils";

function scene(toolOrder: string[] = []) {
  return {
    id: "s1",
    name: "日常",
    toolOrder,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function renderScenes() {
  return render(() => (
    <PriorityScenes
      client={toolPriorityScenes}
      orderOf={(item) => item.toolOrder}
      items={[
        { id: "t1", name: "工具一" },
        { id: "t2", name: "工具二" },
      ]}
      addLabel="工具"
      emptyLabel="该场景暂无工具"
      renderList={(ids, onRemove) => (
        <div>
          <For each={ids}>
            {(id) => (
              <button type="button" onClick={() => onRemove(id)}>
                移除 {id}
              </button>
            )}
          </For>
        </div>
      )}
    />
  ));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PriorityScenes", () => {
  it("loads scenes and persists an added item with a reorder PATCH", async () => {
    const fetchMock = stubFetch({
      "GET /api/tool-priorities": { body: { scenes: [scene()] } },
      "PATCH /api/tool-priorities/s1": (init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        return { body: { ...scene(body.toolOrder), updatedAt: "2026-01-02" } };
      },
    });
    renderScenes();

    await waitFor(() => expect(screen.getByText("日常")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("添加工具"), {
      target: { value: "t2" },
    });

    await waitFor(() => expect(screen.getByText("移除 t2")).toBeTruthy());
    const patch = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
    );
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body).toEqual({ action: "reorder", toolOrder: ["t2"] });
  });

  it("persists removing an item with the remaining order", async () => {
    const fetchMock = stubFetch({
      "GET /api/tool-priorities": { body: { scenes: [scene(["t1", "t2"])] } },
      "PATCH /api/tool-priorities/s1": (init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        return { body: { ...scene(body.toolOrder), updatedAt: "2026-01-02" } };
      },
    });
    renderScenes();

    await waitFor(() => expect(screen.getByText("移除 t1")).toBeTruthy());
    fireEvent.click(screen.getByText("移除 t1"));

    await waitFor(() => expect(screen.queryByText("移除 t1")).toBeNull());
    const patch = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
    );
    const body = JSON.parse((patch![1] as RequestInit).body as string);
    expect(body).toEqual({ action: "reorder", toolOrder: ["t2"] });
  });

  it("creates a scene through the inline form", async () => {
    const fetchMock = stubFetch({
      "GET /api/tool-priorities": { body: { scenes: [] } },
      "POST /api/tool-priorities": (init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        return { status: 201, body: { ...scene(), id: "s2", name: body.name } };
      },
    });
    renderScenes();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建新场景" })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "创建新场景" }));
    fireEvent.input(screen.getByLabelText("新场景名称"), {
      target: { value: "工作" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(screen.getByText("工作")).toBeTruthy());
    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      name: "工作",
    });
  });
});
