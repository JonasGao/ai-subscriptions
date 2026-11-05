// Port of lib/api-url-resolver.ts: plan-level endpoint resolution with a
// provider-level fallback. Client-safe (no I/O) so the card can decide which
// query affordances to render before any request is made.

import type { Provider } from "./types";

export function resolveUsageApiUrl(
  provider: Provider,
  planId?: string
): string | undefined {
  if (planId && provider.plans) {
    const plan = provider.plans.find((item) => item.id === planId);
    if (plan?.usageApiUrl) return plan.usageApiUrl;
  }
  return provider.usageApiUrl;
}

export function resolveModelsApiUrl(
  provider: Provider,
  planId?: string
): string | undefined {
  if (planId && provider.plans) {
    const plan = provider.plans.find((item) => item.id === planId);
    if (plan?.modelsApiUrl) return plan.modelsApiUrl;
  }
  return provider.modelsApiUrl;
}

/**
 * Whether the models endpoint needs stored credentials. A plan-level flag
 * overrides the provider-level one; defaults to true so public endpoints
 * (alibaba coding-plan) are the only ones that opt out.
 */
export function resolveModelsRequireCredentials(
  provider: Provider,
  planId?: string
): boolean {
  if (planId && provider.plans) {
    const plan = provider.plans.find((item) => item.id === planId);
    if (plan?.modelsRequireCredentials !== undefined) {
      return plan.modelsRequireCredentials;
    }
  }
  return provider.modelsRequireCredentials ?? true;
}

/** Which quota query a subscription supports, derived from its provider. */
export function resolveQueryKind(
  provider: Provider | undefined,
  subscriptionType: string,
  planId?: string
): "usage" | "balance" | null {
  if (!provider) return null;
  if (subscriptionType === "one-time") {
    return provider.balanceApiUrl ? "balance" : null;
  }
  return resolveUsageApiUrl(provider, planId) ? "usage" : null;
}
