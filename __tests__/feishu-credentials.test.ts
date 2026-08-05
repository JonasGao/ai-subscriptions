import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFeishuCredentials } from "@/lib/notifications/feishu-credentials";
import type { NotificationChannel } from "@/lib/types";

// Mock the storage module
vi.mock("@/lib/notifications/storage", () => ({
  getChannelById: vi.fn(),
}));

import { getChannelById } from "@/lib/notifications/storage";
const mockGetChannelById = vi.mocked(getChannelById);

const feishuChannel: NotificationChannel = {
  id: "ch-1",
  type: "feishu-app",
  name: "Test",
  appId: "stored-app-id",
  appSecret: "stored-app-secret",
  receiveId: "ou_xxx",
  receiveIdType: "open_id",
  enabled: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("resolveFeishuCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns direct credentials from body when both appId and appSecret present", () => {
    const body = {
      appId: "direct-app-id",
      appSecret: "direct-app-secret",
    };

    const result = resolveFeishuCredentials(body);

    expect(result).toEqual({
      appId: "direct-app-id",
      appSecret: "direct-app-secret",
    });
    expect(mockGetChannelById).not.toHaveBeenCalled();
  });

  it("uses stored credentials when channelId provided and stored channel has appSecret", () => {
    mockGetChannelById.mockReturnValue(feishuChannel);

    const body = { channelId: "ch-1" };
    const result = resolveFeishuCredentials(body);

    expect(result).toEqual({
      appId: "stored-app-id",
      appSecret: "stored-app-secret",
    });
  });

  it("uses body appId with stored appSecret when only appId provided in body", () => {
    mockGetChannelById.mockReturnValue(feishuChannel);

    const body = { channelId: "ch-1", appId: "new-app-id" };
    const result = resolveFeishuCredentials(body);

    expect(result).toEqual({
      appId: "new-app-id",
      appSecret: "stored-app-secret",
    });
  });

  it("throws when neither direct credentials nor channelId provided", () => {
    const body = { appId: "app-id" }; // No appSecret, no channelId

    expect(() => resolveFeishuCredentials(body)).toThrow(
      /请提供 appId 和 appSecret/
    );
  });

  it("throws when channelId does not exist", () => {
    mockGetChannelById.mockReturnValue(null);

    const body = { channelId: "nonexistent" };

    expect(() => resolveFeishuCredentials(body)).toThrow(/不存在/);
  });

  it("throws when channel is not feishu-app type", () => {
    const webhookChannel: NotificationChannel = {
      id: "ch-2",
      type: "webhook",
      name: "Webhook",
      url: "https://example.com",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    mockGetChannelById.mockReturnValue(webhookChannel);

    const body = { channelId: "ch-2" };

    expect(() => resolveFeishuCredentials(body)).toThrow(/不是 feishu-app/);
  });

  it("throws when stored channel has no appSecret", () => {
    const channelNoSecret: NotificationChannel = {
      id: "ch-3",
      type: "feishu-app",
      name: "Test",
      appId: "app-id",
      // No appSecret
      receiveId: "ou_xxx",
      receiveIdType: "open_id",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    mockGetChannelById.mockReturnValue(channelNoSecret);

    const body = { channelId: "ch-3" };

    expect(() => resolveFeishuCredentials(body)).toThrow(
      /没有已存储的 appSecret/
    );
  });

  it("trims whitespace from credentials", () => {
    const body = {
      appId: "  app-id  ",
      appSecret: "  app-secret  ",
    };

    const result = resolveFeishuCredentials(body);

    expect(result).toEqual({
      appId: "app-id",
      appSecret: "app-secret",
    });
  });
});
