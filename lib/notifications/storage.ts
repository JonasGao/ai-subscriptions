import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  NotificationChannel,
  NotificationData,
  BalanceTransitionState,
  DEFAULT_LOW_BALANCE_THRESHOLD,
} from "@/lib/types";
import { ensureDataDir, atomicWriteFile, dataDir } from "@/lib/file-ops";

const notificationsFile = path.join(dataDir, "notifications.json");

function getInitialData(): NotificationData {
  return {
    channels: [],
    defaultLowBalanceThreshold: DEFAULT_LOW_BALANCE_THRESHOLD,
    balanceTransitionStates: {},
  };
}

export function readNotificationData(): NotificationData {
  ensureDataDir();

  if (!fs.existsSync(notificationsFile)) {
    const initialData = getInitialData();
    atomicWriteFile(notificationsFile, JSON.stringify(initialData, null, 2));
    return initialData;
  }

  try {
    const fileContent = fs.readFileSync(notificationsFile, "utf-8");
    const parsed = JSON.parse(fileContent) as Partial<NotificationData>;
    return {
      channels: parsed.channels ?? [],
      defaultLowBalanceThreshold:
        parsed.defaultLowBalanceThreshold ?? DEFAULT_LOW_BALANCE_THRESHOLD,
      balanceTransitionStates: parsed.balanceTransitionStates ?? {},
    };
  } catch (error) {
    console.error(
      "[notifications] Failed to read notifications.json, using defaults:",
      error
    );
    return getInitialData();
  }
}

export function writeNotificationData(data: NotificationData): void {
  ensureDataDir();
  atomicWriteFile(notificationsFile, JSON.stringify(data, null, 2));
}

export function listChannels(): NotificationChannel[] {
  return readNotificationData().channels;
}

export function updateChannelSendResult(
  id: string,
  result: NotificationChannel["lastSendResult"]
): void {
  const data = readNotificationData();
  const idx = data.channels.findIndex((c) => c.id === id);
  if (idx === -1) return;
  data.channels[idx].lastSendResult = result;
  writeNotificationData(data);
}

export function getBalanceTransitionState(
  subscriptionId: string
): BalanceTransitionState | null {
  const data = readNotificationData();
  return data.balanceTransitionStates[subscriptionId] ?? null;
}

export function setBalanceTransitionState(
  subscriptionId: string,
  state: BalanceTransitionState
): void {
  const data = readNotificationData();
  data.balanceTransitionStates[subscriptionId] = state;
  writeNotificationData(data);
}

// ============ Channel CRUD ============

/**
 * Creates a new notification channel. The caller is responsible for
 * validating the input (type-specific fields) before calling.
 */
export function createChannel(
  input: Omit<
    NotificationChannel,
    "id" | "createdAt" | "updatedAt" | "enabled" | "lastSendResult"
  > & {
    enabled?: boolean;
  }
): NotificationChannel {
  const data = readNotificationData();
  const now = new Date().toISOString();
  const channel: NotificationChannel = {
    id: uuidv4(),
    type: input.type,
    name: input.name,
    url: input.url,
    secret: input.secret,
    appId: input.appId,
    appSecret: input.appSecret,
    receiveId: input.receiveId,
    receiveIdType: input.receiveIdType,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  data.channels.push(channel);
  writeNotificationData(data);
  return channel;
}

/**
 * Returns the channel with the given id, or null if not found.
 */
export function getChannelById(id: string): NotificationChannel | null {
  const data = readNotificationData();
  return data.channels.find((c) => c.id === id) ?? null;
}

/**
 * Updates a channel's mutable fields. Unknown keys in `patch` are ignored.
 * `updatedAt` is refreshed. Returns the updated channel, or null if the
 * channel does not exist.
 */
export function updateChannel(
  id: string,
  patch: Partial<
    Pick<
      NotificationChannel,
      | "type"
      | "name"
      | "url"
      | "secret"
      | "appId"
      | "appSecret"
      | "receiveId"
      | "receiveIdType"
      | "enabled"
    >
  >
): NotificationChannel | null {
  const data = readNotificationData();
  const idx = data.channels.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const existing = data.channels[idx];
  const updated: NotificationChannel = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  data.channels[idx] = updated;
  writeNotificationData(data);
  return updated;
}

/**
 * Deletes a channel by id. Returns true if a channel was removed, false if
 * no channel with that id existed.
 */
export function deleteChannel(id: string): boolean {
  const data = readNotificationData();
  const before = data.channels.length;
  data.channels = data.channels.filter((c) => c.id !== id);
  if (data.channels.length === before) return false;
  writeNotificationData(data);
  return true;
}

/**
 * Toggles a channel's enabled state. Returns the updated channel, or null
 * if not found. Implemented as a single read+write (not a read-then-call-
 * to-updateChannel) so we don't pay for two file reads.
 */
export function toggleChannelEnabled(id: string): NotificationChannel | null {
  const data = readNotificationData();
  const idx = data.channels.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const existing = data.channels[idx];
  const updated: NotificationChannel = {
    ...existing,
    enabled: !existing.enabled,
    updatedAt: new Date().toISOString(),
  };
  data.channels[idx] = updated;
  writeNotificationData(data);
  return updated;
}

// ============ Global default threshold ============

export function getDefaultLowBalanceThreshold(): number {
  return readNotificationData().defaultLowBalanceThreshold;
}

export function setDefaultLowBalanceThreshold(value: number): void {
  const data = readNotificationData();
  data.defaultLowBalanceThreshold = value;
  writeNotificationData(data);
}
