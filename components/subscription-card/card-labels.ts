import { Subscription, defaultProviders } from "@/lib/types";

export function getStatusBadgeVariant(
  status: Subscription["status"]
): "success" | "warning" | "outline" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "cancelled":
      return "outline";
    default:
      return "outline";
  }
}

export function getStatusLabel(status: Subscription["status"]): string {
  switch (status) {
    case "active":
      return "活跃";
    case "paused":
      return "暂停";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function getProviderName(
  provider: string,
  providerCustom?: string
): string {
  if (provider === "other" && providerCustom) {
    return providerCustom;
  }
  const found = defaultProviders.find((p) => p.id === provider);
  return found?.name || provider;
}

export function getPlanName(provider: string, planId?: string): string | null {
  if (!planId) return null;
  const found = defaultProviders.find((p) => p.id === provider);
  const plan = found?.plans?.find((p) => p.id === planId);
  return plan?.name ?? null;
}

export function getTypeLabel(type: string): string {
  return type === "recurring" ? "周期性" : "一次性";
}
