import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  createChannel,
  getDefaultLowBalanceThreshold,
  setDefaultLowBalanceThreshold,
} from "@/lib/notifications/storage";
import { NotificationChannelType } from "@/lib/types";
import {
  VALID_CHANNEL_TYPES,
  safeWebhookUrl,
  safeNonEmptyString,
  safeReceiveIdType,
  isWebhookChannelType,
  isFeishuAppChannelType,
  sanitizeChannelForClient,
  parseJsonBody,
} from "@/lib/notifications/channel-validate";

export async function GET() {
  try {
    const channels = listChannels().map(sanitizeChannelForClient);
    const defaultLowBalanceThreshold = getDefaultLowBalanceThreshold();
    return NextResponse.json({ channels, defaultLowBalanceThreshold });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications config" },
      { status: 500 }
    );
  }
}

/**
 * POST creates a new notification channel.
 *
 * Body for webhook channels: `{ name, type, url, secret?, enabled? }`.
 * Body for feishu-app: `{ name, type: "feishu-app", appId, appSecret, receiveId, receiveIdType, enabled? }`.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Channel name is required" },
        { status: 400 }
      );
    }

    const type = body.type as NotificationChannelType;
    if (!VALID_CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        {
          error: `Invalid type. Must be one of: ${VALID_CHANNEL_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    // Webhook-based channels (dingtalk/feishu/webhook)
    if (isWebhookChannelType(type)) {
      const url = safeWebhookUrl(body.url);
      if (!url) {
        return NextResponse.json(
          { error: "A valid http(s) webhook URL is required" },
          { status: 400 }
        );
      }

      let secret: string | undefined;
      if (
        body.secret !== undefined &&
        body.secret !== null &&
        body.secret !== ""
      ) {
        if (typeof body.secret !== "string") {
          return NextResponse.json(
            { error: "secret must be a string" },
            { status: 400 }
          );
        }
        secret = body.secret;
      }

      const channel = createChannel({ type, name, url, secret, enabled });
      return NextResponse.json(sanitizeChannelForClient(channel), {
        status: 201,
      });
    }

    // Feishu-app channel
    if (isFeishuAppChannelType(type)) {
      const appId = safeNonEmptyString(body.appId);
      if (!appId) {
        return NextResponse.json(
          { error: "appId is required for feishu-app channel" },
          { status: 400 }
        );
      }

      const appSecret = safeNonEmptyString(body.appSecret);
      if (!appSecret) {
        return NextResponse.json(
          { error: "appSecret is required for feishu-app channel" },
          { status: 400 }
        );
      }

      const receiveId = safeNonEmptyString(body.receiveId);
      if (!receiveId) {
        return NextResponse.json(
          { error: "receiveId is required for feishu-app channel" },
          { status: 400 }
        );
      }

      const receiveIdType = safeReceiveIdType(body.receiveIdType);
      if (!receiveIdType) {
        return NextResponse.json(
          { error: "receiveIdType must be 'open_id' or 'chat_id'" },
          { status: 400 }
        );
      }

      const channel = createChannel({
        type,
        name,
        appId,
        appSecret,
        receiveId,
        receiveIdType,
        enabled,
      });
      return NextResponse.json(sanitizeChannelForClient(channel), {
        status: 201,
      });
    }

    return NextResponse.json(
      { error: "Unsupported channel type" },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/notifications error:", error);
    return NextResponse.json(
      { error: "Failed to create channel" },
      { status: 500 }
    );
  }
}

/**
 * PUT updates the global default low-balance threshold.
 *
 * Body: `{ defaultLowBalanceThreshold: number }`.
 */
export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const value = body.defaultLowBalanceThreshold;
    if (typeof value !== "number" || !isFinite(value) || value < 0) {
      return NextResponse.json(
        { error: "defaultLowBalanceThreshold must be a non-negative number" },
        { status: 400 }
      );
    }

    setDefaultLowBalanceThreshold(value);
    return NextResponse.json({ defaultLowBalanceThreshold: value });
  } catch (error) {
    console.error("PUT /api/notifications error:", error);
    return NextResponse.json(
      { error: "Failed to update threshold" },
      { status: 500 }
    );
  }
}
