/**
 * Feishu WebSocket listener for receiving messages via long connection.
 *
 * Uses @larksuiteoapi/node-sdk WSClient to listen for im.message.receive_v1 events.
 * Listeners are managed per appId in module-level memory (no persistence).
 * Each listener auto-stops after TTL (default 2 minutes) to avoid resource leaks.
 *
 * The WSClient factory is injectable for testing.
 */
import {
  WSClient,
  EventDispatcher,
  LoggerLevel,
} from "@larksuiteoapi/node-sdk";

// ============ Constants ============

/** Default TTL for listeners in seconds. */
export const DEFAULT_LISTENER_TTL_SECONDS = 120;

/** Default TTL in milliseconds (derived from seconds constant). */
export const DEFAULT_LISTENER_TTL_MS = DEFAULT_LISTENER_TTL_SECONDS * 1000;

/** How long to keep tombstone state after stopping (in ms). */
const TOMBSTONE_TTL_MS = 30_000;

// ============ Types ============

export interface ReceivedMessage {
  /** User who sent the message */
  sender: {
    open_id: string;
    user_id?: string;
    union_id?: string;
    name?: string;
  };
  /** Message metadata */
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    create_time: string;
  };
  /** When this message was received by the listener (ISO timestamp) */
  receivedAt: string;
}

export type StopReason = "manual" | "timeout" | "error";

export interface ListenerState {
  appId: string;
  /** Unique ID for this listener instance, used for subsequent operations */
  listenId: string;
  wsClient: WSClient;
  messages: ReceivedMessage[];
  startedAt: string;
  /** Timer handle for auto-stop */
  ttlTimer?: ReturnType<typeof setTimeout>;
  /** Whether the listener has been stopped */
  stopped: boolean;
  /** Reason for stopping (only set after stopped) */
  stopReason?: StopReason;
  /** Timer handle for tombstone cleanup */
  tombstoneTimer?: ReturnType<typeof setTimeout>;
}

export interface ListenerStatus {
  appId: string;
  listenId: string;
  startedAt: string;
  messageCount: number;
  stopped: boolean;
  stopReason?: StopReason;
  ttlSeconds: number;
}

/**
 * Factory function that creates a WSClient. Injectable for testing.
 * Default implementation creates a real WSClient.
 */
export type WSClientFactory = (appId: string, appSecret: string) => WSClient;

// ============ Module state ============

/** Map of appId → listener state. Only one listener per appId at a time. */
const listeners = new Map<string, ListenerState>();

/** Map of listenId → appId for reverse lookup */
const listenIdToAppId = new Map<string, string>();

/** In-flight start promises to prevent race conditions */
const inFlightStarts = new Map<string, Promise<ListenerStatus>>();

/** Injectable WSClient factory. Defaults to creating real WSClient. */
let wsClientFactory: WSClientFactory = (appId, appSecret) => {
  return new WSClient({
    appId,
    appSecret,
    loggerLevel: LoggerLevel.info,
  });
};

/** Injectable now() for testing. */
let nowFn: () => Date = () => new Date();

/** Injectable UUID generator for testing. */
let uuidFn: () => string = () => crypto.randomUUID();

/**
 * Sets the WSClient factory. Used by tests to inject a fake WSClient.
 */
export function setWSClientFactory(factory: WSClientFactory): void {
  wsClientFactory = factory;
}

/**
 * Sets the now() function. Used by tests for deterministic timestamps.
 */
export function setListenerNow(fn: () => Date): void {
  nowFn = fn;
}

/**
 * Sets the UUID generator. Used by tests for deterministic IDs.
 */
export function setListenerUUID(fn: () => string): void {
  uuidFn = fn;
}

/**
 * Resets the listener module to clean state. For test cleanup.
 */
export function resetListeners(): void {
  const appIds = Array.from(listeners.keys());
  for (const appId of appIds) {
    try {
      stopFeishuListener(appId);
    } catch {
      // Ignore errors during cleanup
    }
  }
  listeners.clear();
  listenIdToAppId.clear();
  inFlightStarts.clear();
}

// ============ Public API ============

/**
 * Starts a WebSocket listener for the given appId.
 * If a listener already exists for this appId, returns its status (idempotent).
 * Uses in-flight promise tracking to prevent race conditions on concurrent starts.
 *
 * @param appId - Feishu app ID
 * @param appSecret - Feishu app secret
 * @param opts - Optional TTL override (seconds)
 * @returns Listener status with listenId for subsequent operations
 */
export async function startFeishuListener(
  appId: string,
  appSecret: string,
  opts: { ttlSeconds?: number } = {}
): Promise<ListenerStatus> {
  // Check if listener already exists (not stopped)
  const existing = listeners.get(appId);
  if (existing && !existing.stopped) {
    return getListenerStatus(appId)!;
  }

  // Check if there's an in-flight start for this appId
  const inFlight = inFlightStarts.get(appId);
  if (inFlight) {
    return inFlight;
  }

  // Create the start promise and register it as in-flight
  const startPromise = doStartListener(appId, appSecret, opts);
  inFlightStarts.set(appId, startPromise);

  try {
    const result = await startPromise;
    return result;
  } finally {
    inFlightStarts.delete(appId);
  }
}

/**
 * Internal: performs the actual listener start.
 */
async function doStartListener(
  appId: string,
  appSecret: string,
  opts: { ttlSeconds?: number }
): Promise<ListenerStatus> {
  const listenId = uuidFn();
  const wsClient = wsClientFactory(appId, appSecret);
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_LISTENER_TTL_SECONDS;
  const ttlMs = ttlSeconds * 1000;

  const state: ListenerState = {
    appId,
    listenId,
    wsClient,
    messages: [],
    startedAt: nowFn().toISOString(),
    stopped: false,
  };

  // Set up event dispatcher
  const eventDispatcher = new EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      const msg = data.message;
      const sender = data.sender;
      if (!msg || !sender) return;

      const received: ReceivedMessage = {
        sender: {
          open_id: sender.sender_id?.open_id ?? "",
          user_id: sender.sender_id?.user_id,
          union_id: sender.sender_id?.union_id,
          name: (sender.sender_id as { name?: string })?.name,
        },
        message: {
          message_id: msg.message_id ?? "",
          chat_id: msg.chat_id ?? "",
          chat_type: msg.chat_type ?? "",
          message_type: msg.message_type ?? "",
          create_time: msg.create_time ?? "",
        },
        receivedAt: nowFn().toISOString(),
      };

      state.messages.push(received);
    },
  });

  // Start the WebSocket connection
  await wsClient.start({ eventDispatcher });

  // Set up auto-stop timer
  state.ttlTimer = setTimeout(() => {
    stopFeishuListenerInternal(appId, "timeout").catch(() => {
      // Ignore errors during auto-stop
    });
  }, ttlMs);

  listeners.set(appId, state);
  listenIdToAppId.set(listenId, appId);

  return buildStatus(state, ttlSeconds);
}

/**
 * Stops the listener for the given appId or listenId.
 * Uses the snapshot appId from when the listener started, not any current form value.
 * Returns true if a listener was stopped, false if none existed.
 */
export async function stopFeishuListener(
  appIdOrListenId: string
): Promise<boolean> {
  // Try to resolve as listenId first, then as appId
  let appId = listenIdToAppId.get(appIdOrListenId);
  if (!appId) {
    appId = appIdOrListenId;
  }
  return stopFeishuListenerInternal(appId, "manual");
}

/**
 * Internal: performs the actual stop with a specific reason.
 */
async function stopFeishuListenerInternal(
  appId: string,
  reason: StopReason
): Promise<boolean> {
  const state = listeners.get(appId);
  if (!state || state.stopped) {
    return false;
  }

  // Clear TTL timer
  if (state.ttlTimer) {
    clearTimeout(state.ttlTimer);
    state.ttlTimer = undefined;
  }

  // Close the WebSocket connection
  try {
    state.wsClient.close();
  } catch {
    // Ignore close errors
  }

  state.stopped = true;
  state.stopReason = reason;

  // Set up tombstone cleanup timer
  state.tombstoneTimer = setTimeout(() => {
    cleanupTombstone(appId);
  }, TOMBSTONE_TTL_MS);

  return true;
}

/**
 * Removes a tombstone entry after its TTL expires.
 */
function cleanupTombstone(appId: string): void {
  const state = listeners.get(appId);
  if (state && state.stopped) {
    if (state.tombstoneTimer) {
      clearTimeout(state.tombstoneTimer);
    }
    listenIdToAppId.delete(state.listenId);
    listeners.delete(appId);
  }
}

/**
 * Returns the current status of the listener for the given appId or listenId.
 * Returns null if no listener exists (including expired tombstones).
 */
export function getListenerStatus(
  appIdOrListenId: string
): ListenerStatus | null {
  // Try to resolve as listenId first, then as appId
  let appId = listenIdToAppId.get(appIdOrListenId);
  if (!appId) {
    appId = appIdOrListenId;
  }

  const state = listeners.get(appId);
  if (!state) return null;

  const ttlSeconds = state.ttlTimer
    ? DEFAULT_LISTENER_TTL_SECONDS
    : DEFAULT_LISTENER_TTL_SECONDS; // Simplified: always return default

  return buildStatus(state, ttlSeconds);
}

/**
 * Builds a ListenerStatus from state.
 */
function buildStatus(state: ListenerState, ttlSeconds: number): ListenerStatus {
  return {
    appId: state.appId,
    listenId: state.listenId,
    startedAt: state.startedAt,
    messageCount: state.messages.length,
    stopped: state.stopped,
    stopReason: state.stopReason,
    ttlSeconds,
  };
}

/**
 * Returns all messages received by the listener for the given appId or listenId.
 * Returns empty array if no listener exists.
 */
export function getListenerMessages(
  appIdOrListenId: string
): ReceivedMessage[] {
  // Try to resolve as listenId first, then as appId
  let appId = listenIdToAppId.get(appIdOrListenId);
  if (!appId) {
    appId = appIdOrListenId;
  }

  const state = listeners.get(appId);
  if (!state) return [];
  return [...state.messages];
}

/**
 * Returns true if a listener is currently active (not stopped) for the given appId.
 */
export function isListenerActive(appId: string): boolean {
  const state = listeners.get(appId);
  return state !== undefined && !state.stopped;
}
