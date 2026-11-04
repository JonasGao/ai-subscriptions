// Typed client for the proxy-subscription endpoints (app/api/proxy-*/** in the
// old stack). Shapes mirror lib/types.ts ProxySubscription*.
import { ApiError } from "../auth/api";
import type { ProxySubscriptionStatus } from "./dates";

export interface ProxySubscription {
  id: string;
  name: string;
  monthlyPrice: number;
  expirationDate?: string;
  website?: string;
  notes?: string;
  status: ProxySubscriptionStatus;
  tagIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProxySubscriptionTag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProxySubscriptionFormData {
  name: string;
  monthlyPrice: number;
  expirationDate?: string;
  website?: string;
  notes?: string;
  status: ProxySubscriptionStatus;
  tagNames?: string[];
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `请求失败（${res.status}）`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Keep the status-based fallback message.
  }
  return new ApiError(message, res.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

const jsonBody = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function listProxySubscriptions(): Promise<ProxySubscription[]> {
  return request<ProxySubscription[]>("/api/proxy-subscriptions");
}

export function listProxyTags(): Promise<ProxySubscriptionTag[]> {
  return request<ProxySubscriptionTag[]>("/api/proxy-tags");
}

export function createProxySubscription(
  data: ProxySubscriptionFormData
): Promise<ProxySubscription> {
  return request<ProxySubscription>(
    "/api/proxy-subscriptions",
    jsonBody(data)
  );
}

export function updateProxySubscription(
  id: string,
  data: ProxySubscriptionFormData
): Promise<ProxySubscription> {
  return request<ProxySubscription>(`/api/proxy-subscriptions/${id}`, {
    ...jsonBody(data),
    method: "PUT",
  });
}

export async function deleteProxySubscription(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/proxy-subscriptions/${id}`, {
    method: "DELETE",
  });
}

export function renameProxyTag(
  id: string,
  name: string
): Promise<ProxySubscriptionTag> {
  return request<ProxySubscriptionTag>(`/api/proxy-tags/${id}`, {
    ...jsonBody({ name }),
    method: "PATCH",
  });
}

export function deleteProxyTag(
  id: string
): Promise<{ tagId: string; affectedSubscriptionIds: string[] }> {
  return request<{ tagId: string; affectedSubscriptionIds: string[] }>(
    `/api/proxy-tags/${id}`,
    { method: "DELETE" }
  );
}
