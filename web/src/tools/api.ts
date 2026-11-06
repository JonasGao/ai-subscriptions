// API client for the managed-tool catalog (#35). Error bodies come straight
// from the server (the old stack surfaced {error} verbatim).

import type { Tool, ToolFormData } from "./types";

async function parseError(res: Response): Promise<Error> {
  let message = `请求失败（${res.status}）`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON error bodies keep the status-based message.
  }
  const error = new Error(message);
  error.name = "ApiError";
  return error;
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
