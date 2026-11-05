// Wire types and the CRUD client for the subscription surface. The shapes are
// the old stack's lib/types.ts verbatim — they are the API contract.

export type SubscriptionStatus = "active" | "paused" | "cancelled";
export type SubscriptionType = "recurring" | "one-time";
export type BillingCycle = "monthly" | "yearly";
export type ResetScheduleType = "fiveHour" | "weekly" | "monthly";

export interface ResetSchedule {
  id: string;
  enabled: boolean;
  type: ResetScheduleType;
  timeOfDay?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  nextResetTime: string;
  exhausted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  subscriptionType: SubscriptionType;
  billingCycle?: BillingCycle;
  price: number;
  startDate?: string;
  renewalDate?: string;
  status: SubscriptionStatus;
  notes?: string;
  hasCredentials?: boolean;
  balance?: number;
  balanceCurrency?: string;
  lowBalanceThreshold?: number;
  resetSchedules?: ResetSchedule[];
  planId?: string;
  tagIds?: string[];
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** SubscriptionFormData is what the create/edit form submits. */
export interface SubscriptionFormData {
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  subscriptionType: SubscriptionType;
  billingCycle?: BillingCycle;
  price: number;
  startDate?: string;
  renewalDate?: string;
  status: SubscriptionStatus;
  notes?: string;
  /** Credentials travel as plaintext fields; the server encrypts on write. */
  credentials?: Record<string, string>;
  balance?: number;
  lowBalanceThreshold?: number | null;
  resetSchedules?: ResetSchedule[];
  planId?: string;
  tagNames?: string[];
}

export interface PlanDefinition {
  id: string;
  name: string;
  usageApiUrl?: string;
  modelsApiUrl?: string;
  modelsRequireCredentials?: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  type: "text" | "password";
}

export interface Provider {
  id: string;
  name: string;
  description?: string;
  website?: string;
  balanceApiUrl?: string;
  usageApiUrl?: string;
  modelsApiUrl?: string;
  modelsRequireCredentials?: boolean;
  credentialFields?: CredentialField[];
  plans?: PlanDefinition[];
  supportsBalanceQuery?: boolean;
  supportsUsageQuery?: boolean;
  supportsModelsQuery?: boolean;
}

/**
 * EnrichedProvider is one /api/providers row: the static registry entry plus
 * capability flags and subscription/tool reference counts (ADR-0006).
 */
export interface EnrichedProvider extends Provider {
  supportsBalanceQuery: boolean;
  supportsUsageQuery: boolean;
  supportsModelsQuery: boolean;
  subscriptionCount: number;
  toolCount: number;
}

/** UnregisteredProviderName is an in-use custom provider name with its count. */
export interface UnregisteredProviderName {
  name: string;
  count: number;
}

/** BalanceInfo is one currency line of a balance query result. */
export interface BalanceInfo {
  currency: string;
  available: string;
  total: string | null;
  toppedUp: string | null;
  granted: string | null;
  used: string | null;
  frozen: string | null;
  extras?: { label: string; value: string }[];
}

export interface BalanceResult {
  provider: string;
  isAvailable: boolean;
  balanceInfos: BalanceInfo[];
}

export interface UsageWindow {
  limit: string;
  used: string;
  remaining: string;
  resetTime: string | null;
}

export interface UsageResult {
  provider: string;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  monthly: UsageWindow | null;
  warnings?: string[];
}

/** UsageQueryResponse is the usage route body: usage fields + the subscription. */
export interface UsageQueryResponse extends UsageResult {
  subscription?: Subscription;
}

/** ModelsResult is the models route body: deduped, sorted model ids. */
export interface ModelsResult {
  models: string[];
}

/** defaultCategories mirrors lib/types.ts (the server seeds the same list). */
export const defaultCategories: string[] = ["官方订阅", "中转站"];
