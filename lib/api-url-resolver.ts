import { Provider } from "./types";

/**
 * Resolves the usage API URL for a provider/plan.
 * If planId is provided and the provider has plans,
 * returns the plan-level usageApiUrl; otherwise returns the
 * provider-level usageApiUrl.
 * Client-safe: no fs/db dependencies.
 */
export function resolveUsageApiUrl(
  provider: Provider,
  planId?: string
): string | undefined {
  if (planId && provider.plans) {
    const plan = provider.plans.find((p) => p.id === planId);
    if (plan?.usageApiUrl) {
      return plan.usageApiUrl;
    }
  }
  return provider.usageApiUrl;
}

/**
 * Resolves the models API URL for a provider/plan.
 * If planId is provided and the provider has plans,
 * returns the plan-level modelsApiUrl; otherwise returns the
 * provider-level modelsApiUrl.
 * Client-safe: no fs/db dependencies.
 */
export function resolveModelsApiUrl(
  provider: Provider,
  planId?: string
): string | undefined {
  if (planId && provider.plans) {
    const plan = provider.plans.find((p) => p.id === planId);
    if (plan?.modelsApiUrl) {
      return plan.modelsApiUrl;
    }
  }
  return provider.modelsApiUrl;
}
