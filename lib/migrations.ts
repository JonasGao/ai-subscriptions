import fs from "fs";
import path from "path";
import { dataDir, ensureDataDir, atomicWriteFile } from "./file-ops";

const subscriptionsFile = path.join(dataDir, "subscriptions.json");

interface RawSubscription {
  provider: string;
  subscriptionType?: string;
  planId?: string;
  [key: string]: unknown;
}

interface RawSubscriptionData {
  subscriptions: RawSubscription[];
  [key: string]: unknown;
}

/**
 * Startup migration for the provider-plans refactor (ADR-0005).
 *
 * - Rewrites legacy pseudo-provider ids (`fangzhou-codingplan`,
 *   `fangzhou-agentplan`) to `provider: "fangzhou"` with the
 *   corresponding `planId`.
 * - Backfills `planId: "kimi-code"` on existing recurring Moonshot
 *   subscriptions that don't already have one.
 *
 * Idempotent: running it twice produces no further changes.
 */
export function migrateProviderPlans(): void {
  ensureDataDir();

  if (!fs.existsSync(subscriptionsFile)) {
    return;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(subscriptionsFile, "utf-8");
  } catch (error) {
    console.error("[migration] Failed to read subscriptions.json:", error);
    return;
  }

  let data: RawSubscriptionData;
  try {
    data = JSON.parse(raw) as RawSubscriptionData;
  } catch (error) {
    console.error("[migration] Failed to parse subscriptions.json:", error);
    return;
  }

  if (!Array.isArray(data.subscriptions)) {
    return;
  }

  let changed = false;

  for (const sub of data.subscriptions) {
    // Migrate fangzhou-codingplan → fangzhou + planId: codingplan
    if (sub.provider === "fangzhou-codingplan") {
      sub.provider = "fangzhou";
      sub.planId = "codingplan";
      changed = true;
      continue;
    }

    // Migrate fangzhou-agentplan → fangzhou + planId: agentplan
    if (sub.provider === "fangzhou-agentplan") {
      sub.provider = "fangzhou";
      sub.planId = "agentplan";
      changed = true;
      continue;
    }

    // Backfill moonshot recurring subscriptions with planId: kimi-code
    if (
      sub.provider === "moonshot" &&
      sub.subscriptionType === "recurring" &&
      !sub.planId
    ) {
      sub.planId = "kimi-code";
      changed = true;
    }

    // Backfill alibaba recurring subscriptions based on subscription name
    // Heuristic: match "Coding" → coding-plan, "Token" → token-plan
    if (
      sub.provider === "alibaba" &&
      sub.subscriptionType === "recurring" &&
      !sub.planId &&
      typeof sub.name === "string"
    ) {
      const name = sub.name.toLowerCase();
      if (name.includes("coding")) {
        sub.planId = "coding-plan";
        changed = true;
      } else if (name.includes("token")) {
        sub.planId = "token-plan";
        changed = true;
      }
    }
  }

  if (changed) {
    try {
      atomicWriteFile(subscriptionsFile, JSON.stringify(data, null, 2));
      console.log("[migration] Provider-plans migration applied");
    } catch (error) {
      console.error("[migration] Failed to write subscriptions.json:", error);
    }
  }
}
