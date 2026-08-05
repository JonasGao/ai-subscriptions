/**
 * Feishu WebSocket listener for receiving messages via long connection.
 *
 * Uses @larksuiteoapi/node-sdk WSClient to listen for im.message.receive_v1 events.
 * Listeners are managed per appId in module-level memory (no persistence).
 * Each listener auto-stops after TTL (default 2 minutes) to avoid resource leaks.
 *
 * The WSClient factory is injectable for testing.
 */
import lark from "@larksuiteoapi/node-sdk";

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

export interface ListenerState {
  appId: string;
  wsClient: lark.WSClient;
  messages: ReceivedMessage[];
  startedAt: string;
  /** Timer handle for auto-stop */
  ttlTimer?: ReturnType<typeof setTimeout>;
  /** Whether the listener has been explicitly stopped */
  stopped: boolean;
}

export interface ListenerStatus {
  appId: string;
  startedAt: string;
  messageCount: number;
  stopped: boolean;
}

/**
 * Factory function that creates a WSClient. Injectable for testing.
 * Default implementation creates a real lark.WSClient.
 */
export type WSClientFactory = (
  appId: string,
  appSecret: string
) => lark.WSClient;

// ============ Module state ============

/** Map of appId → listener state. Only one listener per appId at a time. */
const listeners = new Map<string, ListenerState>();

/** Default TTL for listeners (2 minutes). */
const DEFAULT_TTL_MS = 2 * 60 * 1000;

/** Injectable WSClient factory. Defaults to creating real lark.WSClient. */
let wsClientFactory: WSClientFactory = (appId, appSecret) => {
  return new lark.WSClient({
    appId,
    appSecret,
    loggerLevel: lark.LoggerLevel.info,
  });
};

/** Injectable now() for testing. */
let nowFn: () => Date = () => new Date();

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
}

// ============ Public API ============

/**
 * Starts a WebSocket listener for the given appId.
 * If a listener already exists for this appId, returns its status (idempotent).
 *
 * @param appId - Feishu app ID
 * @param appSecret - Feishu app secret
 * @param opts - Optional TTL override (ms)
 * @returns Listener status
 */
export async function startFeishuListener(
  appId: string,
  appSecret: string,
  opts: { ttlMs?: number } = {}
): Promise<ListenerStatus> {
  // Check if listener already exists
  const existing = listeners.get(appId);
  if (existing && !existing.stopped) {
    return getListenerStatus(appId)!;
  }

  // Create new listener
  const wsClient = wsClientFactory(appId, appSecret);
  const state: ListenerState = {
    appId,
    wsClient,
    messages: [],
    startedAt: nowFn().toISOString(),
    stopped: false,
  };

  // Set up event dispatcher
  const eventDispatcher = new lark.EventDispatcher({}).register({
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
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  state.ttlTimer = setTimeout(() => {
    stopFeishuListener(appId).catch(() => {
      // Ignore errors during auto-stop
    });
  }, ttlMs);

  listeners.set(appId, state);

  return getListenerStatus(appId)!;
}

/**
 * Stops the listener for the given appId.
 * Returns true if a listener was stopped, false if none existed.
 */
export async function stopFeishuListener(appId: string): Promise<boolean> {
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
  listeners.delete(appId);
  return true;
}

/**
 * Returns the current status of the listener for the given appId.
 * Returns null if no listener exists.
 */
export function getListenerStatus(appId: string): ListenerStatus | null {
  const state = listeners.get(appId);
  if (!state) return null;

  return {
    appId: state.appId,
    startedAt: state.startedAt,
    messageCount: state.messages.length,
    stopped: state.stopped,
  };
}

/**
 * Returns all messages received by the listener for the given appId.
 * Returns empty array if no listener exists.
 */
export function getListenerMessages(appId: string): ReceivedMessage[] {
  const state = listeners.get(appId);
  if (!state) return [];
  return [...state.messages];
}

/**
 * Returns true if a listener is currently active for the given appId.
 */
export function isListenerActive(appId: string): boolean {
  const state = listeners.get(appId);
  return state !== undefined && !state.stopped;
}
