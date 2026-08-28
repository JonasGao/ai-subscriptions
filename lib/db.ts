import fs from "fs";
import path from "path";
import {
  Subscription,
  SubscriptionData,
  SubscriptionStatus,
  SubscriptionType,
  BillingCycle,
  defaultCategories,
  defaultProviders,
  ResetSchedule,
  ResetScheduleType,
  ResetTickTrigger,
  Provider,
  Tag,
} from "./types";
import { v4 as uuidv4 } from "uuid";
import { ensureDataDir, atomicWriteFile, dataDir } from "./file-ops";
import { encryptApiKey, decryptApiKey, encryptCredentials } from "./encryption";
import {
  createResetSchedule,
  updateResetScheduleNextTime,
  validateResetSchedule,
} from "./reset-schedule";
import { deriveStatus } from "./status-policy";
import { validateTagName, validateTagNames } from "./tags";

const dataFile = path.join(dataDir, "subscriptions.json");
const prioritiesFile = path.join(dataDir, "priorities.json");

function getInitialData(): SubscriptionData {
  return {
    subscriptions: [],
    categories: defaultCategories,
    tags: [],
  };
}

function resolveTagIds(data: SubscriptionData, names: unknown): string[] {
  const tagNames = validateTagNames(names);
  const now = new Date().toISOString();
  const tags = (data.tags ??= []);

  return tagNames.map((name) => {
    const existing = tags.find((tag) => tag.name === name);
    if (existing) {
      return existing.id;
    }

    const tag: Tag = {
      id: uuidv4(),
      name,
      createdAt: now,
      updatedAt: now,
    };
    tags.push(tag);
    return tag.id;
  });
}

/** Each subscription may hold at most one schedule per type. */
function assertUniqueScheduleTypes(schedules: ResetSchedule[]): void {
  const seenTypes = new Set<ResetScheduleType>();
  for (const schedule of schedules) {
    if (seenTypes.has(schedule.type)) {
      throw new Error(
        `Duplicate schedule type "${schedule.type}" — each type is allowed at most once`
      );
    }
    seenTypes.add(schedule.type);
  }
}

export function readData(): SubscriptionData {
  ensureDataDir();

  if (!fs.existsSync(dataFile)) {
    const initialData = getInitialData();
    atomicWriteFile(dataFile, JSON.stringify(initialData, null, 2));
    return initialData;
  }

  try {
    const fileContent = fs.readFileSync(dataFile, "utf-8");
    let needsWrite = false;
    const data = JSON.parse(fileContent) as SubscriptionData;

    if (!Array.isArray(data.tags)) {
      data.tags = [];
      needsWrite = true;
    }

    const knownTagIds = new Set(data.tags.map((tag) => tag.id));
    data.subscriptions = data.subscriptions.map((sub) => {
      const rawTagIds = Array.isArray(sub.tagIds) ? sub.tagIds : [];
      const tagIds = Array.from(
        new Set(
          rawTagIds.filter(
            (tagId): tagId is string =>
              typeof tagId === "string" && knownTagIds.has(tagId)
          )
        )
      );

      if (!Array.isArray(sub.tagIds) || tagIds.length !== rawTagIds.length) {
        needsWrite = true;
      }

      return {
        ...sub,
        subscriptionType: sub.subscriptionType || "recurring",
        billingCycle: sub.billingCycle || "monthly",
        tagIds,
      };
    });

    // Migrate apiKey → credentials
    data.subscriptions.forEach((sub) => {
      const legacy = sub as unknown as Record<string, unknown>;
      const legacyApiKey = legacy.apiKey as string | undefined;
      if (legacyApiKey && !sub.credentials) {
        let plainKey = legacyApiKey;
        if (plainKey.includes(":")) {
          plainKey = decryptApiKey(plainKey);
        }
        const credObj: Record<string, string> = { apiKey: plainKey };
        sub.credentials = encryptCredentials(credObj);
        delete legacy.apiKey;
        needsWrite = true;
      }
    });

    data.subscriptions.forEach((sub) => {
      if (sub.resetSchedules) {
        const validSchedules: ResetSchedule[] = [];

        sub.resetSchedules.forEach((schedule) => {
          try {
            validateResetSchedule(schedule);
            validSchedules.push(schedule);

            if (schedule.exhausted === undefined) {
              schedule.exhausted = false;
              needsWrite = true;
            }
          } catch (error) {
            console.error(`Skipping invalid schedule:`, error);
          }
        });

        if (sub.resetSchedules.length !== validSchedules.length) {
          sub.resetSchedules = validSchedules;
          needsWrite = true;
        }

        // Deduplicate: keep at most one schedule per type (earliest createdAt wins)
        const byType = new Map<ResetScheduleType, ResetSchedule>();
        for (const schedule of sub.resetSchedules) {
          const existing = byType.get(schedule.type);
          if (!existing || schedule.createdAt < existing.createdAt) {
            byType.set(schedule.type, schedule);
          }
        }
        const deduped = Array.from(byType.values());
        if (deduped.length !== sub.resetSchedules.length) {
          sub.resetSchedules = deduped;
          // A dropped duplicate may have been the exhausted one that drove the
          // stored status; recompute so status stays consistent with the
          // surviving schedules.
          sub.status = deriveStatus(sub);
          needsWrite = true;
        }
      }
    });

    if (needsWrite) {
      atomicWriteFile(dataFile, JSON.stringify(data, null, 2));
    }

    return data;
  } catch (error) {
    console.error("Failed to parse data file:", error);
    const initialData = getInitialData();
    atomicWriteFile(dataFile, JSON.stringify(initialData, null, 2));
    return initialData;
  }
}

export function writeData(data: SubscriptionData): void {
  ensureDataDir();
  atomicWriteFile(dataFile, JSON.stringify(data, null, 2));
}

export function getSubscriptions(): Subscription[] {
  const data = readData();
  return data.subscriptions;
}

export function getSubscriptionById(id: string): Subscription | null {
  const subscriptions = getSubscriptions();
  return subscriptions.find((s) => s.id === id) || null;
}

export function createSubscription(
  subscriptionData: Omit<
    Subscription,
    "id" | "createdAt" | "updatedAt" | "tagIds"
  >,
  tagNames: unknown = []
): Subscription {
  if (!subscriptionData.name || subscriptionData.name.trim() === "") {
    throw new Error("Subscription name is required");
  }

  if (
    typeof subscriptionData.price !== "number" ||
    subscriptionData.price < 0
  ) {
    throw new Error("Price must be a non-negative number");
  }

  if (
    subscriptionData.balance !== undefined &&
    (typeof subscriptionData.balance !== "number" ||
      subscriptionData.balance < 0)
  ) {
    throw new Error("Balance must be a non-negative number");
  }

  if (
    subscriptionData.lowBalanceThreshold !== undefined &&
    subscriptionData.lowBalanceThreshold !== null &&
    (typeof subscriptionData.lowBalanceThreshold !== "number" ||
      !Number.isFinite(subscriptionData.lowBalanceThreshold) ||
      subscriptionData.lowBalanceThreshold < 0)
  ) {
    throw new Error("lowBalanceThreshold must be a non-negative finite number");
  }

  const validTypes: SubscriptionType[] = ["recurring", "one-time"];
  if (
    subscriptionData.subscriptionType &&
    !validTypes.includes(subscriptionData.subscriptionType)
  ) {
    throw new Error("Invalid subscriptionType");
  }

  const validBillingCycles: BillingCycle[] = ["monthly", "yearly"];
  if (
    subscriptionData.billingCycle &&
    !validBillingCycles.includes(subscriptionData.billingCycle)
  ) {
    throw new Error("Invalid billingCycle");
  }

  if (
    subscriptionData.subscriptionType === "recurring" &&
    !subscriptionData.billingCycle
  ) {
    throw new Error("billingCycle is required for recurring subscriptions");
  }

  // Uniqueness: at most one schedule per type
  if (subscriptionData.resetSchedules) {
    assertUniqueScheduleTypes(subscriptionData.resetSchedules);
  }

  const data = readData();
  const now = new Date().toISOString();
  const subType = subscriptionData.subscriptionType || "recurring";
  const tagIds = resolveTagIds(data, tagNames);

  const resolvedPlanId = resolvePlanId(
    subscriptionData.provider,
    subType,
    subscriptionData.planId
  );

  const newSubscription: Subscription = {
    ...subscriptionData,
    subscriptionType: subType,
    planId: resolvedPlanId,
    tagIds,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };

  if (newSubscription.credentials) {
    newSubscription.credentials = encryptCredentials(
      JSON.parse(newSubscription.credentials)
    );
  }

  data.subscriptions.push(newSubscription);
  writeData(data);

  return newSubscription;
}

export function updateSubscription(
  id: string,
  updates: Partial<Omit<Subscription, "id" | "createdAt" | "tagIds">>,
  tagNames?: unknown
): Subscription | null {
  if (
    updates.name !== undefined &&
    (typeof updates.name !== "string" || updates.name.trim() === "")
  ) {
    throw new Error("Subscription name must be a non-empty string");
  }

  if (
    updates.price !== undefined &&
    (typeof updates.price !== "number" || updates.price < 0)
  ) {
    throw new Error("Price must be a non-negative number");
  }

  if (
    updates.balance !== undefined &&
    (typeof updates.balance !== "number" || updates.balance < 0)
  ) {
    throw new Error("Balance must be a non-negative number");
  }

  if (
    updates.balanceCurrency !== undefined &&
    (typeof updates.balanceCurrency !== "string" ||
      updates.balanceCurrency.trim() === "")
  ) {
    throw new Error("balanceCurrency must be a non-empty string");
  }

  if (
    updates.lowBalanceThreshold !== undefined &&
    updates.lowBalanceThreshold !== null &&
    (typeof updates.lowBalanceThreshold !== "number" ||
      !Number.isFinite(updates.lowBalanceThreshold) ||
      updates.lowBalanceThreshold < 0)
  ) {
    throw new Error("lowBalanceThreshold must be a non-negative finite number");
  }

  const validStatuses: SubscriptionStatus[] = ["active", "paused", "cancelled"];
  if (updates.status !== undefined && !validStatuses.includes(updates.status)) {
    throw new Error("Invalid status value");
  }

  const validTypes: SubscriptionType[] = ["recurring", "one-time"];
  if (
    updates.subscriptionType !== undefined &&
    !validTypes.includes(updates.subscriptionType)
  ) {
    throw new Error("Invalid subscriptionType value");
  }

  const validBillingCycles: BillingCycle[] = ["monthly", "yearly"];
  if (
    updates.billingCycle !== undefined &&
    !validBillingCycles.includes(updates.billingCycle)
  ) {
    throw new Error("Invalid billingCycle value");
  }

  // Uniqueness: at most one schedule per type
  if (updates.resetSchedules) {
    assertUniqueScheduleTypes(updates.resetSchedules);
  }

  if (updates.credentials && typeof updates.credentials === "string") {
    updates.credentials = encryptCredentials(JSON.parse(updates.credentials));
  }

  const data = readData();
  const index = data.subscriptions.findIndex((s) => s.id === id);

  if (index === -1) {
    return null;
  }

  const existing = data.subscriptions[index];
  const tagIds =
    tagNames === undefined
      ? (existing.tagIds ?? [])
      : resolveTagIds(data, tagNames);

  // Resolve planId based on effective provider + subscriptionType
  if (
    updates.provider !== undefined ||
    updates.subscriptionType !== undefined ||
    updates.planId !== undefined
  ) {
    const effectiveProvider = updates.provider ?? existing.provider;
    const effectiveType =
      (updates.subscriptionType as SubscriptionType | undefined) ??
      existing.subscriptionType;
    const effectivePlanId =
      updates.planId !== undefined ? updates.planId : existing.planId;
    updates.planId = resolvePlanId(
      effectiveProvider,
      effectiveType,
      effectivePlanId
    );
  }

  const updatedSubscription: Subscription = {
    ...existing,
    ...updates,
    tagIds,
    updatedAt: new Date().toISOString(),
  };

  // Schedule edits derive status unless the caller explicitly chose one.
  if (updates.resetSchedules !== undefined && updates.status === undefined) {
    updatedSubscription.status = deriveStatus(updatedSubscription);
  }

  data.subscriptions[index] = updatedSubscription;

  writeData(data);
  return data.subscriptions[index];
}

export function deleteSubscription(id: string): boolean {
  const data = readData();
  const index = data.subscriptions.findIndex((s) => s.id === id);

  if (index === -1) {
    return false;
  }

  data.subscriptions.splice(index, 1);
  writeData(data);

  if (fs.existsSync(prioritiesFile)) {
    try {
      const pRaw = fs.readFileSync(prioritiesFile, "utf-8");
      const pData = JSON.parse(pRaw);
      let pChanged = false;
      pData.scenes?.forEach((scene: { subscriptionOrder: string[] }) => {
        const idx = scene.subscriptionOrder.indexOf(id);
        if (idx !== -1) {
          scene.subscriptionOrder.splice(idx, 1);
          pChanged = true;
        }
      });
      if (pChanged) {
        atomicWriteFile(prioritiesFile, JSON.stringify(pData, null, 2));
      }
    } catch {}
  }

  return true;
}

export function getCategories(): string[] {
  const data = readData();
  return data.categories;
}

export function getTags(): Tag[] {
  return [...(readData().tags ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export function renameTag(id: string, rawName: unknown): Tag | null {
  const name = validateTagName(rawName);
  const data = readData();
  const tags = (data.tags ??= []);
  const tag = tags.find((item) => item.id === id);

  if (!tag) {
    return null;
  }
  if (tags.some((item) => item.id !== id && item.name === name)) {
    throw new Error("标签名称已存在");
  }
  if (tag.name === name) {
    return tag;
  }

  tag.name = name;
  tag.updatedAt = new Date().toISOString();
  writeData(data);
  return tag;
}

export interface DeleteTagResult {
  tagId: string;
  affectedSubscriptionIds: string[];
}

export function deleteTag(id: string): DeleteTagResult | null {
  const data = readData();
  const tags = (data.tags ??= []);
  const tagIndex = tags.findIndex((tag) => tag.id === id);

  if (tagIndex === -1) {
    return null;
  }

  const affectedSubscriptionIds: string[] = [];
  const now = new Date().toISOString();
  for (const subscription of data.subscriptions) {
    if (subscription.tagIds?.includes(id)) {
      subscription.tagIds = subscription.tagIds.filter((tagId) => tagId !== id);
      subscription.updatedAt = now;
      affectedSubscriptionIds.push(subscription.id);
    }
  }

  tags.splice(tagIndex, 1);
  writeData(data);

  return { tagId: id, affectedSubscriptionIds };
}

export function addCategory(category: string): string[] {
  const data = readData();

  if (data.categories.includes(category)) {
    return data.categories;
  }

  data.categories.push(category);
  writeData(data);
  return data.categories;
}

export function deleteCategory(category: string): string[] {
  const data = readData();

  // Safety check: prevent deleting categories with subscriptions
  const inUse = data.subscriptions.some((s) => s.category === category);
  if (inUse) {
    throw new Error("Cannot delete category with subscriptions");
  }

  const originalLength = data.categories.length;
  data.categories = data.categories.filter((c) => c !== category);

  if (data.categories.length === originalLength) {
    // Category didn't exist, no change needed
    return data.categories;
  }

  writeData(data);
  return data.categories;
}

export function getProviders(): Provider[] {
  return defaultProviders;
}

/**
 * Resolves planId for a subscription based on the provider's plan offerings.
 * - one-time → always clears planId (plans are recurring-only)
 * - recurring, no plans → undefined
 * - recurring, single plan, no planId provided → auto-fill that plan
 * - recurring, multiple plans, planId provided → keep as-is
 * - recurring, multiple plans, no planId → throws (user must choose)
 * - recurring, planId provided but invalid → throws
 */
export function resolvePlanId(
  providerId: string,
  subscriptionType: SubscriptionType,
  planId?: string
): string | undefined {
  if (subscriptionType !== "recurring") {
    return undefined;
  }

  const provider = defaultProviders.find((p) => p.id === providerId);
  const plans = provider?.plans;

  if (!plans || plans.length === 0) {
    return undefined;
  }

  if (plans.length === 1) {
    return plans[0].id;
  }

  // Multiple plans — planId is required
  if (!planId) {
    throw new Error(
      `Provider "${providerId}" has multiple plans; planId is required`
    );
  }

  const plan = plans.find((p) => p.id === planId);
  if (!plan) {
    throw new Error(`Plan "${planId}" not found for provider "${providerId}"`);
  }

  return planId;
}

export function addResetSchedule(
  subscriptionId: string,
  scheduleData: {
    type: ResetScheduleType;
    enabled?: boolean;
    timeOfDay?: string;
    dayOfWeek?: number;
    dayOfMonth?: number;
  }
): ResetSchedule | null {
  const data = readData();
  const index = data.subscriptions.findIndex((s) => s.id === subscriptionId);

  if (index === -1) {
    return null;
  }

  // Uniqueness: at most one schedule per type
  const existing = data.subscriptions[index].resetSchedules;
  if (existing?.some((s) => s.type === scheduleData.type)) {
    throw new Error(
      `Schedule type "${scheduleData.type}" already exists for this subscription`
    );
  }

  const schedule = createResetSchedule(scheduleData);

  if (!data.subscriptions[index].resetSchedules) {
    data.subscriptions[index].resetSchedules = [];
  }

  data.subscriptions[index].resetSchedules!.push(schedule);
  data.subscriptions[index].updatedAt = new Date().toISOString();

  writeData(data);
  return schedule;
}

export function updateResetSchedule(
  subscriptionId: string,
  scheduleId: string,
  updates: Partial<Omit<ResetSchedule, "id" | "createdAt">>
): ResetSchedule | null {
  const data = readData();
  const subIndex = data.subscriptions.findIndex((s) => s.id === subscriptionId);

  if (subIndex === -1 || !data.subscriptions[subIndex].resetSchedules) {
    return null;
  }

  const scheduleIndex = data.subscriptions[subIndex].resetSchedules!.findIndex(
    (s) => s.id === scheduleId
  );

  if (scheduleIndex === -1) {
    return null;
  }

  const schedule = data.subscriptions[subIndex].resetSchedules![scheduleIndex];
  const updatedSchedule: ResetSchedule = {
    ...schedule,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  if (
    updates.type ||
    updates.timeOfDay ||
    updates.dayOfWeek ||
    updates.dayOfMonth
  ) {
    const nextReset = updateResetScheduleNextTime(updatedSchedule);
    updatedSchedule.nextResetTime = nextReset.nextResetTime;
  }

  data.subscriptions[subIndex].resetSchedules![scheduleIndex] = updatedSchedule;
  data.subscriptions[subIndex].updatedAt = new Date().toISOString();

  writeData(data);
  return updatedSchedule;
}

export function deleteResetSchedule(
  subscriptionId: string,
  scheduleId: string
): boolean {
  const data = readData();
  const subIndex = data.subscriptions.findIndex((s) => s.id === subscriptionId);

  if (subIndex === -1 || !data.subscriptions[subIndex].resetSchedules) {
    return false;
  }

  const scheduleIndex = data.subscriptions[subIndex].resetSchedules!.findIndex(
    (s) => s.id === scheduleId
  );

  if (scheduleIndex === -1) {
    return false;
  }

  data.subscriptions[subIndex].resetSchedules!.splice(scheduleIndex, 1);
  data.subscriptions[subIndex].updatedAt = new Date().toISOString();

  writeData(data);
  return true;
}

export function processResetTick(): ResetTickTrigger[] {
  const data = readData();
  const now = new Date();
  const nowIso = now.toISOString();
  const triggers: ResetTickTrigger[] = [];
  let anyFired = false;

  data.subscriptions.forEach((sub) => {
    if (sub.status === "cancelled") {
      return;
    }

    if (!sub.resetSchedules) {
      return;
    }

    let subAnyFired = false;

    sub.resetSchedules.forEach((schedule) => {
      if (!schedule.enabled) {
        return;
      }

      const nextReset = new Date(schedule.nextResetTime);
      if (now >= nextReset) {
        const wasExhausted = schedule.exhausted;
        schedule.exhausted = false;
        try {
          const nextSchedule = updateResetScheduleNextTime(schedule);
          schedule.nextResetTime = nextSchedule.nextResetTime;
          schedule.updatedAt = nowIso;
        } catch (error) {
          console.warn(
            "Failed to update reset time for schedule:",
            schedule.id,
            error
          );
          return;
        }
        subAnyFired = true;
        anyFired = true;
        // Only notify when the schedule was genuinely exhausted and the
        // reset actually restores availability.  If it was already available
        // (exhausted=false), there is nothing worth notifying about.
        if (wasExhausted) {
          triggers.push({
            subscriptionId: sub.id,
            scheduleType: schedule.type,
            nextResetTime: schedule.nextResetTime,
          });
        }
      }
    });

    if (subAnyFired) {
      const newStatus = deriveStatus(sub);
      if (newStatus !== sub.status) {
        sub.status = newStatus;
        sub.updatedAt = nowIso;
      }
    }
  });

  if (anyFired) {
    writeData(data);
  }

  return triggers;
}

export function toggleScheduleExhausted(
  subscriptionId: string,
  scheduleId: string,
  exhausted: boolean
): Subscription | null {
  const data = readData();
  const subIndex = data.subscriptions.findIndex((s) => s.id === subscriptionId);

  if (subIndex === -1 || !data.subscriptions[subIndex].resetSchedules) {
    return null;
  }

  const scheduleIndex = data.subscriptions[subIndex].resetSchedules!.findIndex(
    (s) => s.id === scheduleId
  );

  if (scheduleIndex === -1) {
    return null;
  }

  const now = new Date().toISOString();
  data.subscriptions[subIndex].resetSchedules![scheduleIndex].exhausted =
    exhausted;
  data.subscriptions[subIndex].resetSchedules![scheduleIndex].updatedAt = now;

  const newStatus = deriveStatus(data.subscriptions[subIndex]);
  data.subscriptions[subIndex].status = newStatus;
  data.subscriptions[subIndex].updatedAt = now;

  writeData(data);
  return data.subscriptions[subIndex];
}
