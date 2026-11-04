// API client for the subscription, category and tag routes. Error bodies come
// straight from the server (the old stack surfaced {error} verbatim).

import type {
  Subscription,
  SubscriptionFormData,
  Tag,
  Provider,
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

export function fetchSubscriptions(): Promise<Subscription[]> {
  return requestJSON<Subscription[]>("/api/subscriptions");
}

export function fetchCategories(): Promise<string[]> {
  return requestJSON<string[]>("/api/categories");
}

export function fetchTags(): Promise<Tag[]> {
  return requestJSON<Tag[]>("/api/tags");
}

export function fetchProviders(): Promise<Provider[]> {
  return requestJSON<Provider[]>("/api/providers");
}

export function createSubscription(
  data: SubscriptionFormData
): Promise<Subscription> {
  return requestJSON<Subscription>("/api/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateSubscription(
  id: string,
  data: Partial<SubscriptionFormData>
): Promise<Subscription> {
  return requestJSON<Subscription>(`/api/subscriptions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteSubscription(id: string): Promise<{ success: boolean }> {
  return requestJSON<{ success: boolean }>(`/api/subscriptions/${id}`, {
    method: "DELETE",
  });
}

/**
 * toggleScheduleExhausted marks one schedule available or exhausted
 * (POST /api/subscriptions/{id}/schedules/{scheduleId}/toggle). The route
 * answers the updated subscription, so the caller can replace its copy.
 */
export function toggleScheduleExhausted(
  subscriptionId: string,
  scheduleId: string,
  exhausted: boolean
): Promise<Subscription> {
  return requestJSON<Subscription>(
    `/api/subscriptions/${subscriptionId}/schedules/${scheduleId}/toggle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exhausted }),
    }
  );
}

export function renameTag(id: string, name: string): Promise<Tag> {
  return requestJSON<Tag>(`/api/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteTag(id: string): Promise<{ tagId: string }> {
  return requestJSON<{ tagId: string }>(`/api/tags/${id}`, {
    method: "DELETE",
  });
}
