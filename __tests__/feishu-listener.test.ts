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

  beforeEach(() => {
    resetListeners();
    fakeClient = createFakeWSClient();
    setWSClientFactory(() => fakeClient.instance as never);
    setListenerNow(() => new Date("2024-06-01T00:00:00Z"));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetListeners();
  });

  it("starts a listener and returns status", async () => {
    const status = await startFeishuListener("app-1", "secret-1");

    expect(status.appId).toBe("app-1");
    expect(status.stopped).toBe(false);
    expect(status.messageCount).toBe(0);
    expect(status.startedAt).toBe("2024-06-01T00:00:00.000Z");
    expect(fakeClient.instance.start).toHaveBeenCalledTimes(1);
  });

  it("returns existing status when listener already active (idempotent)", async () => {
    await startFeishuListener("app-1", "secret-1");
    const status = await startFeishuListener("app-1", "secret-1");

    expect(status.appId).toBe("app-1");
    expect(fakeClient.instance.start).toHaveBeenCalledTimes(1); // Still only 1 call
  });

  it("isListenerActive returns correct state", async () => {
    expect(isListenerActive("app-1")).toBe(false);

    await startFeishuListener("app-1", "secret-1");
    expect(isListenerActive("app-1")).toBe(true);

    await stopFeishuListener("app-1");
    expect(isListenerActive("app-1")).toBe(false);
  });

  it("stops a listener and cleans up", async () => {
    await startFeishuListener("app-1", "secret-1");

    const stopped = await stopFeishuListener("app-1");

    expect(stopped).toBe(true);
    expect(fakeClient.instance.close).toHaveBeenCalledTimes(1);
    expect(isListenerActive("app-1")).toBe(false);
    expect(getListenerStatus("app-1")).toBeNull();
  });

  it("stop returns false when no listener exists", async () => {
    const stopped = await stopFeishuListener("nonexistent");
    expect(stopped).toBe(false);
  });

  it("auto-stops after TTL expires", async () => {
    await startFeishuListener("app-1", "secret-1", { ttlMs: 5000 });

    expect(isListenerActive("app-1")).toBe(true);

    vi.advanceTimersByTime(5000);

    // Wait for async stop to complete
    await Promise.resolve();

    expect(isListenerActive("app-1")).toBe(false);
    expect(fakeClient.instance.close).toHaveBeenCalledTimes(1);
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
});
