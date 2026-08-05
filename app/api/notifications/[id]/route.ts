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
import {
  NotificationChannel,
  NotificationChannelType,
  Subscription,
} from "@/lib/types";

const VALID_TYPES: NotificationChannelType[] = [
  "dingtalk",
  "feishu",
  "webhook",
];

function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return trimmed;
  } catch {
    return null;
  }
}

function stripSecret(
  channel: NotificationChannel
): Omit<NotificationChannel, "secret"> & { hasSecret: boolean } {
  const { secret, ...rest } = channel;
  return { ...rest, hasSecret: Boolean(secret) };
}

/**
 * Builds a synthetic low-balance event for test sends. The event uses a
 * placeholder subscription so the payload builder has something to render.
 * The channel itself is swapped in by the caller before send.
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
  const prepared = prepareSend(channel, event);
  await httpSender(prepared);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const channel = getChannelById(params.id);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json(stripSecret(channel));
  } catch (error) {
    console.error("GET /api/notifications/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch channel" },
      { status: 500 }
    );
  }
}

/**
 * PUT updates a channel's mutable fields: name, type, url, secret, enabled.
 *
 * Special case for `secret`:
 *  - omitted / null → leave existing secret untouched
 *  - empty string → clear the secret
 *  - string → replace
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

    const body = await request.json();

    const patch: Partial<
      Pick<NotificationChannel, "name" | "type" | "url" | "secret" | "enabled">
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
      if (!VALID_TYPES.includes(body.type)) {
        return NextResponse.json(
          { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
      patch.type = body.type;
    }

    if (body.url !== undefined) {
      const url = safeUrl(body.url);
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

    if (body.enabled !== undefined) {
      patch.enabled = Boolean(body.enabled);
    }

    const updated = updateChannel(params.id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    return NextResponse.json(stripSecret(updated));
  } catch (error) {
    console.error("PUT /api/notifications/[id] error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
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

    const body = await request.json();
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
          channel: refreshed ? stripSecret(refreshed) : null,
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
            channel: refreshed ? stripSecret(refreshed) : null,
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
      return NextResponse.json(stripSecret(updated));
    }

    return NextResponse.json(
      { error: `Unknown action. Use "test" or "toggle".` },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/notifications/[id] error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
