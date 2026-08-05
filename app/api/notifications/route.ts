import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  createChannel,
  getDefaultLowBalanceThreshold,
  setDefaultLowBalanceThreshold,
} from "@/lib/notifications/storage";
import { NotificationChannel, NotificationChannelType } from "@/lib/types";

const VALID_TYPES: NotificationChannelType[] = [
  "dingtalk",
  "feishu",
  "webhook",
];

/**
 * Strip the signing secret from a channel before it leaves the server.
 * `hasSecret` is returned so the UI can indicate whether one is configured
 * (e.g. to show a "change secret" placeholder instead of an empty field).
 */
function stripSecret(
  channel: NotificationChannel
): Omit<NotificationChannel, "secret"> & { hasSecret: boolean } {
  const { secret, ...rest } = channel;
  return { ...rest, hasSecret: Boolean(secret) };
}

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

export async function GET() {
  try {
    const channels = listChannels().map(stripSecret);
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
 * Body: `{ name, type, url, secret?, enabled? }`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Channel name is required" },
        { status: 400 }
      );
    }

    const type: NotificationChannelType = body.type;
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const url = safeUrl(body.url);
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

    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    const channel = createChannel({ type, name, url, secret, enabled });
    return NextResponse.json(stripSecret(channel), { status: 201 });
  } catch (error) {
    console.error("POST /api/notifications error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
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
    const body = await request.json();

    if (
      typeof body.defaultLowBalanceThreshold !== "number" ||
      !isFinite(body.defaultLowBalanceThreshold) ||
      body.defaultLowBalanceThreshold < 0
    ) {
      return NextResponse.json(
        { error: "defaultLowBalanceThreshold must be a non-negative number" },
        { status: 400 }
      );
    }

    setDefaultLowBalanceThreshold(body.defaultLowBalanceThreshold);
    return NextResponse.json({
      defaultLowBalanceThreshold: body.defaultLowBalanceThreshold,
    });
  } catch (error) {
    console.error("PUT /api/notifications error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update threshold" },
      { status: 500 }
    );
  }
}
