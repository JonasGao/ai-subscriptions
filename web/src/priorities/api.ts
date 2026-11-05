// API client for /api/priorities, /api/tool-priorities and /api/tools (#35).
// Error bodies come straight from the server (the old stack surfaced {error}
// verbatim).

import type {
  PriorityScene,
  Tool,
  ToolFormData,
  ToolPriorityScene,
} from "./types";

/** ApiError carries the server's error message verbatim. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `请求失败（${res.status}）`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON error bodies keep the status-based message.
  }
  return new ApiError(message, res.status);
}

async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** SceneClient is the shared shape of the two priority-scene families. */
export interface SceneClient<T extends { id: string; name: string }> {
  list(): Promise<T[]>;
  create(name: string): Promise<T>;
  rename(id: string, name: string): Promise<T>;
  remove(id: string): Promise<{ success: boolean }>;
  reorder(id: string, order: string[]): Promise<T>;
}

function createSceneClient<T extends { id: string; name: string }>(
  basePath: string,
  orderField: "subscriptionOrder" | "toolOrder"
): SceneClient<T> {
  const list = async (): Promise<T[]> => {
    const data = await requestJSON<{ scenes: T[] }>(basePath);
    return data.scenes;
  };
  return {
    list,
    create: (name) => requestJSON<T>(basePath, jsonInit("POST", { name })),
    rename: (id, name) =>
      requestJSON<T>(`${basePath}/${id}`, jsonInit("PUT", { name })),
    remove: (id) =>
      requestJSON<{ success: boolean }>(`${basePath}/${id}`, {
        method: "DELETE",
      }),
    reorder: (id, order) =>
      requestJSON<T>(
        `${basePath}/${id}`,
        jsonInit("PATCH", { action: "reorder", [orderField]: order })
      ),
  };
}

export const priorityScenes = createSceneClient<PriorityScene>(
  "/api/priorities",
  "subscriptionOrder"
);

export const toolPriorityScenes = createSceneClient<ToolPriorityScene>(
  "/api/tool-priorities",
  "toolOrder"
);

export function listTools(): Promise<Tool[]> {
  return requestJSON<Tool[]>("/api/tools");
}

export function createTool(data: ToolFormData): Promise<Tool> {
  return requestJSON<Tool>("/api/tools", jsonInit("POST", data));
}

export function updateTool(
  id: string,
  data: Partial<ToolFormData>
): Promise<Tool> {
  return requestJSON<Tool>(`/api/tools/${id}`, jsonInit("PUT", data));
}

export function deleteTool(id: string): Promise<{ success: boolean }> {
  return requestJSON<{ success: boolean }>(`/api/tools/${id}`, {
    method: "DELETE",
  });
}

export function reorderTools(toolIds: string[]): Promise<Tool[]> {
  return requestJSON<Tool[]>("/api/tools", jsonInit("PATCH", { toolIds }));
}
