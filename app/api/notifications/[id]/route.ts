import { NextRequest, NextResponse } from "next/server";
import {
  getChannelById,
  updateChannel,
  deleteChannel,
  toggleChannelEnabled,
  updateChannelSendResult,
} from "@/lib/notifications/storage";
import {
  prepareSend,
  httpSender,
  NotificationEvent,
} from "@/lib/notifications/payload";
import { sendFeishuAppMessage } from "@/lib/notifications/feishu-app";
import { NotificationChannel, Subscription } from "@/lib/types";
import {
  VALID_CHANNEL_TYPES,
  safeWebhookUrl,
  safeNonEmptyString,
  safeReceiveIdType,
  sanitizeChannelForClient,
  parseJsonBody,
} from "@/lib/notifications/channel-validate";

/**
 * Builds a synthetic low-balance event for test sends. The event uses a
 * placeholder subscription so the payload builder has something to render.
 */
function buildTestEvent(): NotificationEvent {
  const now = new Date().toISOString();
  const fakeSubscription: Subscription = {
    id: "test",
    name: "测试订阅",
    category: "其他",
    provider: "other",
    subscriptionType: "one-time",
    price: 0,
    status: "active",
    balance: 1,
    createdAt: now,
    updatedAt: now,
  };
  return {
    kind: "low-balance",
    subscription: fakeSubscription,
    balance: 1,
    threshold: 10,
    triggeredAt: now,
  };
}

async function sendTest(channel: NotificationChannel): Promise<void> {
  const event = buildTestEvent();
  if (channel.type === "feishu-app") {
    if (
      !channel.appId ||
      !channel.appSecret ||
      !channel.receiveId ||
      !channel.receiveIdType
    ) {
      throw new Error(
        "feishu-app channel is missing required fields (appId/appSecret/receiveId/receiveIdType)"
      );
    }
    await sendFeishuAppMessage(event, {
      appId: channel.appId,
      appSecret: channel.appSecret,
      receiveId: channel.receiveId,
      receiveIdType: channel.receiveIdType,
    });
    return;
  }
  const prepared = prepareSend(channel, event);
  await httpSender(prepared);
}

/**
 * PUT updates a channel's mutable fields.
 *
 * Webhook channels: name, type, url, secret, enabled.
 * Feishu-app channels: name, type, appId, appSecret, receiveId, receiveIdType, enabled.
 *
 * Special case for `secret` / `appSecret`:
 *  - omitted → leave existing value untouched
 *  - null or empty string → clear
 *  - non-empty string → replace
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const existing = getChannelById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const patch: Partial<
      Pick<
        import("@/lib/types").NotificationChannel,
        | "name"
        | "type"
        | "url"
        | "secret"
        | "appId"
        | "appSecret"
        | "receiveId"
        | "receiveIdType"
        | "enabled"
      >
    > = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "Channel name cannot be empty" },
          { status: 400 }
        );
      }
      patch.name = name;
    }

    if (body.type !== undefined) {
      if (
        typeof body.type !== "string" ||
        !(VALID_CHANNEL_TYPES as readonly string[]).includes(body.type)
      ) {
        return NextResponse.json(
          {
            error: `Invalid type. Must be one of: ${VALID_CHANNEL_TYPES.join(", ")}`,
          },
          { status: 400 }
        );
      }
      patch.type = body.type as import("@/lib/types").NotificationChannelType;
    }

    // Webhook fields
    if (body.url !== undefined) {
      const url = safeWebhookUrl(body.url);
      if (!url) {
        return NextResponse.json(
          { error: "A valid http(s) webhook URL is required" },
          { status: 400 }
        );
      }
      patch.url = url;
    }

    if (body.secret !== undefined) {
      if (body.secret === null || body.secret === "") {
        patch.secret = undefined;
      } else if (typeof body.secret !== "string") {
        return NextResponse.json(
          { error: "secret must be a string" },
          { status: 400 }
        );
      } else {
        patch.secret = body.secret;
      }
    }

    // Feishu-app fields
    if (body.appId !== undefined) {
      const appId = safeNonEmptyString(body.appId);
      if (!appId) {
        return NextResponse.json(
          { error: "appId cannot be empty" },
          { status: 400 }
        );
      }
      patch.appId = appId;
    }

    if (body.appSecret !== undefined) {
      if (body.appSecret === null || body.appSecret === "") {
        patch.appSecret = undefined;
      } else if (typeof body.appSecret !== "string") {
        return NextResponse.json(
          { error: "appSecret must be a string" },
          { status: 400 }
        );
      } else {
        patch.appSecret = body.appSecret;
      }
    }

    if (body.receiveId !== undefined) {
      const receiveId = safeNonEmptyString(body.receiveId);
      if (!receiveId) {
        return NextResponse.json(
          { error: "receiveId cannot be empty" },
          { status: 400 }
        );
      }
      patch.receiveId = receiveId;
    }

    if (body.receiveIdType !== undefined) {
      const receiveIdType = safeReceiveIdType(body.receiveIdType);
      if (!receiveIdType) {
        return NextResponse.json(
          { error: "receiveIdType must be 'open_id' or 'chat_id'" },
          { status: 400 }
        );
      }
      patch.receiveIdType = receiveIdType;
    }

    if (body.enabled !== undefined) {
      patch.enabled = Boolean(body.enabled);
    }

    const updated = updateChannel(params.id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    return NextResponse.json(sanitizeChannelForClient(updated));
  } catch (error) {
    console.error("PUT /api/notifications/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update channel" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const removed = deleteChannel(params.id);
    if (!removed) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/notifications/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete channel" },
      { status: 500 }
    );
  }
}

/**
 * POST dispatches an action on a single channel.
 *
 * Body: `{ action: "test" | "toggle" }`.
 *
 * - "test": sends a real test message through the channel's full
 *   payload/sender pipeline and records the result in lastSendResult.
 * - "toggle": flips the channel's enabled state.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const channel = getChannelById(params.id);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "test") {
      if (!channel.enabled) {
        return NextResponse.json(
          { error: "Cannot test a disabled channel" },
          { status: 400 }
        );
      }
      const startedAt = new Date().toISOString();
      try {
        await sendTest(channel);
        updateChannelSendResult(channel.id, {
          success: true,
          timestamp: startedAt,
        });
        const refreshed = getChannelById(channel.id);
        return NextResponse.json({
          success: true,
          channel: refreshed ? sanitizeChannelForClient(refreshed) : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateChannelSendResult(channel.id, {
          success: false,
          timestamp: startedAt,
          error: message,
        });
        const refreshed = getChannelById(channel.id);
        return NextResponse.json(
          {
            success: false,
            error: message,
            channel: refreshed ? sanitizeChannelForClient(refreshed) : null,
          },
          { status: 502 }
        );
      }
    }

    if (action === "toggle") {
      const updated = toggleChannelEnabled(channel.id);
      if (!updated) {
        return NextResponse.json(
          { error: "Channel not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(sanitizeChannelForClient(updated));
    }

    return NextResponse.json(
      { error: `Unknown action. Use "test" or "toggle".` },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/notifications/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
