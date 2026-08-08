import { Provider, Subscription, Tool } from "@/lib/types";
import { usageHandlers, balanceHandlers } from "./index";

/**
 * Provider enriched with read-only metadata for the /providers page:
 * query-capability flags derived from the handler registries and
 * reference counts from subscriptions/tools.
 */
export interface EnrichedProvider extends Provider {
  supportsBalanceQuery: boolean;
  supportsUsageQuery: boolean;
  subscriptionCount: number;
  toolCount: number;
}

/** A distinct in-use `providerCustom` name (provider === "other") with its usage count. */
export interface UnregisteredProviderName {
  name: string;
  count: number;
}

/**
 * A provider supports usage query if any usageHandlers key equals its id
 * (bare key) or starts with `id:` (plan-level keys).
 */
export function supportsUsageQuery(providerId: string): boolean {
  return Object.keys(usageHandlers).some(
    (key) => key === providerId || key.startsWith(`${providerId}:`)
  );
}

/** Same rule as supportsUsageQuery, over the balanceHandlers registry. */
export function supportsBalanceQuery(providerId: string): boolean {
  return Object.keys(balanceHandlers).some(
    (key) => key === providerId || key.startsWith(`${providerId}:`)
  );
}

/**
 * Enriches providers with capability flags and reference counts.
 * Pure function: callers supply the provider list plus current
 * subscriptions and tools.
 */
export function enrichProviders(
  providers: Provider[],
  subscriptions: Subscription[],
  tools: Tool[]
): EnrichedProvider[] {
  const subscriptionCounts = new Map<string, number>();
  for (const sub of subscriptions) {
    subscriptionCounts.set(
      sub.provider,
      (subscriptionCounts.get(sub.provider) ?? 0) + 1
    );
  }

  const toolCounts = new Map<string, number>();
  for (const tool of tools) {
    toolCounts.set(tool.provider, (toolCounts.get(tool.provider) ?? 0) + 1);
  }

  return providers.map((provider) => ({
    ...provider,
    supportsBalanceQuery: supportsBalanceQuery(provider.id),
    supportsUsageQuery: supportsUsageQuery(provider.id),
    subscriptionCount: subscriptionCounts.get(provider.id) ?? 0,
    toolCount: toolCounts.get(provider.id) ?? 0,
  }));
}

/**
 * Distinct `providerCustom` values in use by subscriptions/tools whose
 * provider is "other", each with its combined usage count.
 * Sorted by count descending, then name ascending.
 */
export function getUnregisteredProviderNames(
  subscriptions: Subscription[],
  tools: Tool[]
): UnregisteredProviderName[] {
  const counts = new Map<string, number>();

  const add = (provider: string, providerCustom?: string) => {
    if (provider !== "other") return;
    const name = providerCustom?.trim();
    if (!name) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };

  for (const sub of subscriptions) add(sub.provider, sub.providerCustom);
  for (const tool of tools) add(tool.provider, tool.providerCustom);

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
