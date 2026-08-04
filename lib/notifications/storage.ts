import fs from "fs";
import path from "path";
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
