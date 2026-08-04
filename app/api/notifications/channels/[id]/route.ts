import { NextRequest, NextResponse } from "next/server";
import {
  updateChannel,
  deleteChannel,
  getChannelById,
} from "@/lib/notifications/storage";
import { prepareSend } from "@/lib/notifications/payload";
import type { NotificationEvent } from "@/lib/notifications/payload";
import type { Subscription } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const channel = getChannelById(params.id);
    if (!channel) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(channel);
  } catch (error) {
    console.error(`GET /api/notifications/channels/${params.id} error:`, error);
    return NextResponse.json(
      { error: "Failed to fetch channel" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.url !== undefined) patch.url = String(body.url).trim();
    if (body.secret !== undefined) {
      patch.secret = body.secret === "" ? undefined : String(body.secret);
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.type !== undefined) {
      if (!["dingtalk", "feishu", "webhook"].includes(body.type)) {
        return NextResponse.json(
          { error: "Invalid channel type" },
          { status: 400 }
        );
      }
      patch.type = body.type;
    }

    const updated = updateChannel(params.id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error(
      `PATCH /api/notifications/channels/${params.id} error:`,
      error
    );
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
    const deleted = deleteChannel(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      `DELETE /api/notifications/channels/${params.id} error:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to delete channel" },
      { status: 500 }
    );
  }
}

// Test send: POST /api/notifications/channels/[id]/test
// Sends a synthetic low-balance event to the channel to validate credentials.
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const channel = getChannelById(params.id);
    if (!channel) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!channel.enabled) {
      return NextResponse.json(
        { error: "Channel is disabled" },
        { status: 400 }
      );
    }

    const placeholderSub: Subscription = {
      id: "test",
      name: "测试订阅",
      category: "其他",
      provider: "other",
      subscriptionType: "one-time",
      price: 0,
      status: "active",
      balance: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const event: NotificationEvent = {
      kind: "low-balance",
      subscription: placeholderSub,
      balance: 1,
      threshold: 10,
      triggeredAt: new Date().toISOString(),
    };

    const prepared = prepareSend(channel, event);
    const response = await fetch(prepared.url, {
      method: "POST",
      headers: prepared.headers,
      body:
        typeof prepared.body === "string"
          ? prepared.body
          : JSON.stringify(prepared.body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        {
          error: `HTTP ${response.status}`,
          detail: text.slice(0, 500),
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      `POST /api/notifications/channels/${params.id}/test error:`,
      error
    );
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
