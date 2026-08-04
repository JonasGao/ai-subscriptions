import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  createChannel,
  readNotificationData,
  writeNotificationData,
} from "@/lib/notifications/storage";

export async function GET() {
  try {
    const channels = listChannels();
    return NextResponse.json(channels);
  } catch (error) {
    console.error("GET /api/notifications/channels error:", error);
    return NextResponse.json(
      { error: "Failed to fetch channels" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, name, url, secret, enabled } = body;

    if (!["dingtalk", "feishu", "webhook"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid channel type" },
        { status: 400 }
      );
    }
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json(
        { error: "Channel name is required" },
        { status: 400 }
      );
    }
    if (typeof url !== "string" || url.trim() === "") {
      return NextResponse.json(
        { error: "Channel URL is required" },
        { status: 400 }
      );
    }

    const channel = createChannel({
      type,
      name: name.trim(),
      url: url.trim(),
      secret:
        typeof secret === "string" ? secret.trim() || undefined : undefined,
      enabled: typeof enabled === "boolean" ? enabled : true,
    });
    return NextResponse.json(channel, { status: 201 });
  } catch (error) {
    console.error("POST /api/notifications/channels error:", error);
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { defaultLowBalanceThreshold } = body;
    if (
      typeof defaultLowBalanceThreshold !== "number" ||
      !Number.isFinite(defaultLowBalanceThreshold)
    ) {
      return NextResponse.json(
        { error: "defaultLowBalanceThreshold must be a number" },
        { status: 400 }
      );
    }
    const data = readNotificationData();
    data.defaultLowBalanceThreshold = defaultLowBalanceThreshold;
    writeNotificationData(data);
    return NextResponse.json({ defaultLowBalanceThreshold });
  } catch (error) {
    console.error("PATCH /api/notifications/channels error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
