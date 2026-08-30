import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { atomicWriteFile, dataDir, ensureDataDir } from "./file-ops";
import {
  ProxySubscription,
  ProxySubscriptionData,
  ProxySubscriptionFormData,
  ProxySubscriptionStatus,
  ProxySubscriptionTag,
} from "./types";
import { isDateOnly } from "./proxy-utils";

export {
  addCalendarDays,
  calculateProxyExpirationDate,
  getProxyDateNotice,
  getProxyTodayDate,
  isDateOnly,
} from "./proxy-utils";

const dataFile = path.join(dataDir, "proxy-subscriptions.json");
const MAX_TAGS = 20;
const MAX_TAG_NAME_LENGTH = 30;
const MAX_NOTES_LENGTH = 2000;

const initialData = (): ProxySubscriptionData => ({
  subscriptions: [],
  tags: [],
});

function validateTagName(rawName: unknown): string {
  if (typeof rawName !== "string") throw new Error("标签不能为空");
  const name = rawName.trim();
  if (!name) throw new Error("标签不能为空");
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new Error(`标签不能超过 ${MAX_TAG_NAME_LENGTH} 个字符`);
  }
  if (/[\r\n,，]/.test(name)) {
    throw new Error("标签不能包含中英文逗号或换行");
  }
  return name;
}

function resolveTagIds(
  data: ProxySubscriptionData,
  rawNames: unknown
): string[] {
  if (!Array.isArray(rawNames)) throw new Error("tagNames must be an array");
  if (rawNames.length > MAX_TAGS) {
    throw new Error(`每个代理订阅最多添加 ${MAX_TAGS} 个标签`);
  }
  const names = rawNames.map(validateTagName);
  const uniqueNames = Array.from(new Set(names));
  const now = new Date().toISOString();
  return uniqueNames.map((name) => {
    const existing = data.tags.find((tag) => tag.name === name);
    if (existing) return existing.id;
    const tag: ProxySubscriptionTag = {
      id: uuidv4(),
      name,
      createdAt: now,
      updatedAt: now,
    };
    data.tags.push(tag);
    return tag.id;
  });
}

function validateSubscriptionFields(
  input: Partial<ProxySubscriptionFormData>
): void {
  if (
    input.name !== undefined &&
    (typeof input.name !== "string" || !input.name.trim())
  ) {
    throw new Error("代理订阅名称不能为空");
  }
  if (
    input.monthlyPrice !== undefined &&
    (typeof input.monthlyPrice !== "number" ||
      !Number.isFinite(input.monthlyPrice) ||
      input.monthlyPrice < 0)
  ) {
    throw new Error("单月价格必须是非负数字");
  }
  if (
    input.expirationDate !== undefined &&
    input.expirationDate !== "" &&
    !isDateOnly(input.expirationDate)
  ) {
    throw new Error("到期日期必须是 YYYY-MM-DD 格式的有效日期");
  }
  if (input.website !== undefined && input.website !== "") {
    if (typeof input.website !== "string" || input.website.length > 2000) {
      throw new Error("网站地址无效");
    }
    try {
      const url = new URL(input.website);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new Error("网站地址必须是有效的 http 或 https 地址");
    }
  }
  if (
    input.notes !== undefined &&
    (typeof input.notes !== "string" || input.notes.length > MAX_NOTES_LENGTH)
  ) {
    throw new Error(`备注不能超过 ${MAX_NOTES_LENGTH} 个字符`);
  }
  const statuses: ProxySubscriptionStatus[] = ["unused", "in-use", "expired"];
  if (input.status !== undefined && !statuses.includes(input.status)) {
    throw new Error("无效的代理订阅状态");
  }
}

export function readProxyData(): ProxySubscriptionData {
  ensureDataDir();
  if (!fs.existsSync(dataFile)) {
    const data = initialData();
    atomicWriteFile(dataFile, JSON.stringify(data, null, 2));
    return data;
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(dataFile, "utf8")
    ) as Partial<ProxySubscriptionData>;
    const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
    const knownTagIds = new Set(tags.map((tag) => tag.id));
    const subscriptions = Array.isArray(parsed.subscriptions)
      ? parsed.subscriptions.map((subscription) => ({
          ...subscription,
          tagIds: Array.from(
            new Set(
              (Array.isArray(subscription.tagIds)
                ? subscription.tagIds
                : []
              ).filter(
                (id): id is string =>
                  typeof id === "string" && knownTagIds.has(id)
              )
            )
          ),
        }))
      : [];
    return { subscriptions, tags } as ProxySubscriptionData;
  } catch {
    const data = initialData();
    atomicWriteFile(dataFile, JSON.stringify(data, null, 2));
    return data;
  }
}

export function writeProxyData(data: ProxySubscriptionData): void {
  ensureDataDir();
  atomicWriteFile(dataFile, JSON.stringify(data, null, 2));
}

export function getProxySubscriptions(): ProxySubscription[] {
  return readProxyData().subscriptions;
}

export function getProxySubscriptionById(id: string): ProxySubscription | null {
  return (
    getProxySubscriptions().find((subscription) => subscription.id === id) ??
    null
  );
}

export function createProxySubscription(
  input: ProxySubscriptionFormData
): ProxySubscription {
  validateSubscriptionFields(input);
  if (!input.name?.trim()) throw new Error("代理订阅名称不能为空");
  if (input.monthlyPrice === undefined) throw new Error("单月价格不能为空");
  const data = readProxyData();
  const now = new Date().toISOString();
  const subscription: ProxySubscription = {
    name: input.name.trim(),
    monthlyPrice: input.monthlyPrice,
    expirationDate: input.expirationDate || undefined,
    website: input.website || undefined,
    notes: input.notes || undefined,
    status: input.status || "unused",
    tagIds: resolveTagIds(data, input.tagNames ?? []),
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  data.subscriptions.push(subscription);
  writeProxyData(data);
  return subscription;
}

export function updateProxySubscription(
  id: string,
  updates: Partial<
    Omit<ProxySubscription, "id" | "createdAt" | "updatedAt" | "tagIds">
  >,
  tagNames?: unknown
): ProxySubscription | null {
  validateSubscriptionFields(updates);
  const data = readProxyData();
  const index = data.subscriptions.findIndex(
    (subscription) => subscription.id === id
  );
  if (index === -1) return null;
  const existing = data.subscriptions[index];
  // Keep identity and audit fields server-controlled even when API input is untyped.
  const mutableUpdates = {
    name: updates.name,
    monthlyPrice: updates.monthlyPrice,
    expirationDate: updates.expirationDate,
    website: updates.website,
    notes: updates.notes,
    status: updates.status,
  };
  const updated: ProxySubscription = {
    ...existing,
    ...mutableUpdates,
    name: mutableUpdates.name?.trim() ?? existing.name,
    monthlyPrice: mutableUpdates.monthlyPrice ?? existing.monthlyPrice,
    expirationDate: Object.prototype.hasOwnProperty.call(
      updates,
      "expirationDate"
    )
      ? mutableUpdates.expirationDate || undefined
      : existing.expirationDate,
    status: mutableUpdates.status ?? existing.status,
    website:
      mutableUpdates.website === ""
        ? undefined
        : (mutableUpdates.website ?? existing.website),
    notes:
      mutableUpdates.notes === ""
        ? undefined
        : (mutableUpdates.notes ?? existing.notes),
    tagIds:
      tagNames === undefined
        ? (existing.tagIds ?? [])
        : resolveTagIds(data, tagNames),
    updatedAt: new Date().toISOString(),
  };
  data.subscriptions[index] = updated;
  writeProxyData(data);
  return updated;
}

export function deleteProxySubscription(id: string): boolean {
  const data = readProxyData();
  const index = data.subscriptions.findIndex(
    (subscription) => subscription.id === id
  );
  if (index === -1) return false;
  data.subscriptions.splice(index, 1);
  writeProxyData(data);
  return true;
}

export function getProxyTags(): ProxySubscriptionTag[] {
  return [...readProxyData().tags].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export function renameProxyTag(
  id: string,
  rawName: unknown
): ProxySubscriptionTag | null {
  const name = validateTagName(rawName);
  const data = readProxyData();
  const tag = data.tags.find((item) => item.id === id);
  if (!tag) return null;
  if (data.tags.some((item) => item.id !== id && item.name === name)) {
    throw new Error("标签名称已存在");
  }
  tag.name = name;
  tag.updatedAt = new Date().toISOString();
  writeProxyData(data);
  return tag;
}

export function deleteProxyTag(
  id: string
): { tagId: string; affectedSubscriptionIds: string[] } | null {
  const data = readProxyData();
  const index = data.tags.findIndex((tag) => tag.id === id);
  if (index === -1) return null;
  const affectedSubscriptionIds: string[] = [];
  for (const subscription of data.subscriptions) {
    if (subscription.tagIds?.includes(id)) {
      subscription.tagIds = subscription.tagIds.filter((tagId) => tagId !== id);
      subscription.updatedAt = new Date().toISOString();
      affectedSubscriptionIds.push(subscription.id);
    }
  }
  data.tags.splice(index, 1);
  writeProxyData(data);
  return { tagId: id, affectedSubscriptionIds };
}
