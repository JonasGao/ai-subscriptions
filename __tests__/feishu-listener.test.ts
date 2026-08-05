import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startFeishuListener,
  stopFeishuListener,
  getListenerStatus,
  getListenerMessages,
  isListenerActive,
  resetListeners,
  setWSClientFactory,
  setListenerNow,
  setListenerUUID,
  DEFAULT_LISTENER_TTL_SECONDS,
} from "@/lib/notifications/feishu-listener";

// Mock WSClient factory
function createFakeWSClient() {
  let capturedDispatcher: {
    handles: Map<string, (data: unknown) => Promise<void>>;
  } | null = null;
  return {
    instance: {
      start: vi.fn(
        async ({ eventDispatcher }: { eventDispatcher: unknown }) => {
          // Capture the dispatcher so we can invoke handlers in tests
          capturedDispatcher = eventDispatcher as {
            handles: Map<string, (data: unknown) => Promise<void>>;
          };
        }
      ),
      close: vi.fn(),
    },
    invokeEvent: async (data: unknown) => {
      if (!capturedDispatcher) throw new Error("Dispatcher not captured");
      const handler = capturedDispatcher.handles.get("im.message.receive_v1");
      if (!handler) throw new Error("Handler not registered");
      await handler(data);
    },
  };
}

describe("feishu-listener", () => {
  let fakeClient: ReturnType<typeof createFakeWSClient>;
  let uuidCounter = 0;

  beforeEach(() => {
    resetListeners();
    fakeClient = createFakeWSClient();
    setWSClientFactory(() => fakeClient.instance as never);
    setListenerNow(() => new Date("2024-06-01T00:00:00Z"));
    setListenerUUID(() => `listen-id-${++uuidCounter}`);
    uuidCounter = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetListeners();
  });

  it("starts a listener and returns status with listenId and ttlSeconds", async () => {
    const status = await startFeishuListener("app-1", "secret-1");

    expect(status.appId).toBe("app-1");
    expect(status.listenId).toBe("listen-id-1");
    expect(status.stopped).toBe(false);
    expect(status.messageCount).toBe(0);
    expect(status.startedAt).toBe("2024-06-01T00:00:00.000Z");
    expect(status.ttlSeconds).toBe(DEFAULT_LISTENER_TTL_SECONDS);
    expect(fakeClient.instance.start).toHaveBeenCalledTimes(1);
  });

  it("returns existing status when listener already active (idempotent)", async () => {
    const status1 = await startFeishuListener("app-1", "secret-1");
    const status2 = await startFeishuListener("app-1", "secret-1");

    expect(status1.listenId).toBe(status2.listenId);
    expect(fakeClient.instance.start).toHaveBeenCalledTimes(1); // Still only 1 call
  });

  it("prevents race condition on concurrent starts", async () => {
    // Start two concurrent starts for the same appId
    const promise1 = startFeishuListener("app-1", "secret-1");
    const promise2 = startFeishuListener("app-1", "secret-1");

    const [status1, status2] = await Promise.all([promise1, promise2]);

    // Both should return the same listener
    expect(status1.listenId).toBe(status2.listenId);
    expect(fakeClient.instance.start).toHaveBeenCalledTimes(1);
  });

  it("isListenerActive returns correct state", async () => {
    expect(isListenerActive("app-1")).toBe(false);

    await startFeishuListener("app-1", "secret-1");
    expect(isListenerActive("app-1")).toBe(true);

    await stopFeishuListener("app-1");
    expect(isListenerActive("app-1")).toBe(false);
  });

  it("stops a listener and keeps tombstone state", async () => {
    const status = await startFeishuListener("app-1", "secret-1");

    const stopped = await stopFeishuListener(status.listenId);

    expect(stopped).toBe(true);
    expect(fakeClient.instance.close).toHaveBeenCalledTimes(1);
    expect(isListenerActive("app-1")).toBe(false);

    // Tombstone: status should still be available with stopped=true
    const tombstoneStatus = getListenerStatus("app-1");
    expect(tombstoneStatus).not.toBeNull();
    expect(tombstoneStatus?.stopped).toBe(true);
    expect(tombstoneStatus?.stopReason).toBe("manual");
  });

  it("can stop by listenId (snapshot from start response)", async () => {
    const status = await startFeishuListener("app-1", "secret-1");

    // Even if user changes form appId, stopping by listenId still works
    const stopped = await stopFeishuListener(status.listenId);
    expect(stopped).toBe(true);
  });

  it("stop returns false when no listener exists", async () => {
    const stopped = await stopFeishuListener("nonexistent");
    expect(stopped).toBe(false);
  });

  it("auto-stops after TTL expires with timeout reason", async () => {
    await startFeishuListener("app-1", "secret-1", { ttlSeconds: 5 });

    expect(isListenerActive("app-1")).toBe(true);

    vi.advanceTimersByTime(5000);

    // Wait for async stop to complete
    await Promise.resolve();

    expect(isListenerActive("app-1")).toBe(false);
    expect(fakeClient.instance.close).toHaveBeenCalledTimes(1);

    // Tombstone shows timeout reason
    const status = getListenerStatus("app-1");
    expect(status?.stopReason).toBe("timeout");
  });

  it("tombstone is cleaned up after 30 seconds", async () => {
    await startFeishuListener("app-1", "secret-1");
    await stopFeishuListener("app-1");

    // Tombstone exists immediately
    expect(getListenerStatus("app-1")).not.toBeNull();

    // Advance past tombstone TTL (30s)
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    // Tombstone is cleaned up
    expect(getListenerStatus("app-1")).toBeNull();
  });

  it("receives messages and stores them", async () => {
    await startFeishuListener("app-1", "secret-1");

    // Simulate receiving a message
    await fakeClient.invokeEvent({
      sender: {
        sender_id: {
          open_id: "ou_user1",
          user_id: "user1",
        },
        sender_type: "user",
      },
      message: {
        message_id: "msg_1",
        chat_id: "oc_chat1",
        chat_type: "p2p",
        message_type: "text",
        create_time: "1717200000",
        content: '{"text":"hello"}',
      },
    });

    const messages = getListenerMessages("app-1");
    expect(messages).toHaveLength(1);
    expect(messages[0].sender.open_id).toBe("ou_user1");
    expect(messages[0].message.message_id).toBe("msg_1");
    expect(messages[0].receivedAt).toBe("2024-06-01T00:00:00.000Z");

    const status = getListenerStatus("app-1");
    expect(status?.messageCount).toBe(1);
  });

  it("getListenerMessages returns empty array for nonexistent listener", () => {
    const messages = getListenerMessages("nonexistent");
    expect(messages).toEqual([]);
  });

  it("multiple appIds have isolated listeners", async () => {
    await startFeishuListener("app-1", "secret-1");
    await startFeishuListener("app-2", "secret-2");

    expect(isListenerActive("app-1")).toBe(true);
    expect(isListenerActive("app-2")).toBe(true);

    await stopFeishuListener("app-1");

    expect(isListenerActive("app-1")).toBe(false);
    expect(isListenerActive("app-2")).toBe(true);
  });

  it("uses custom ttlSeconds when provided", async () => {
    const status = await startFeishuListener("app-1", "secret-1", {
      ttlSeconds: 60,
    });

    expect(status.ttlSeconds).toBe(60);
  });
});
