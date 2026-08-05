import { NextRequest, NextResponse } from "next/server";
import {
  startFeishuListener,
  stopFeishuListener,
  getListenerStatus,
  getListenerMessages,
} from "@/lib/notifications/feishu-listener";
import { resolveFeishuCredentials } from "@/lib/notifications/feishu-credentials";
import { parseJsonBody } from "@/lib/notifications/channel-validate";

/**
 * POST /api/notifications/feishu-app/listen
 *
 * Starts a WebSocket listener for receiving messages from users.
 * Idempotent: if a listener already exists for this appId, returns its status.
 *
 * Body:
 * - appId + appSecret (direct credentials)
 * - OR channelId (uses stored appSecret)
 * - Optional: ttl_ms (auto-stop timeout, default 120000)
 *
 * Returns: { appId, startedAt, messageCount, stopped }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const creds = resolveFeishuCredentials(body);

    const ttl_ms = typeof body.ttl_ms === "number" ? body.ttl_ms : undefined;

    const status = await startFeishuListener(creds.appId, creds.appSecret, {
      ttlMs: ttl_ms,
    });

    return NextResponse.json(status);
  } catch (error) {
    console.error("POST /api/notifications/feishu-app/listen error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/notifications/feishu-app/listen?appId=xxx
 *
 * Polls the listener status and retrieves received messages.
 *
 * Query params:
 * - appId (required)
 *
 * Returns: { status: {...}, messages: [...] }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get("appId");

    if (!appId) {
      return NextResponse.json({ error: "缺少 appId 参数" }, { status: 400 });
    }

    const status = getListenerStatus(appId);
    if (!status) {
      return NextResponse.json(
        { error: `没有找到 appId=${appId} 的监听器` },
        { status: 404 }
      );
    }

    const messages = getListenerMessages(appId);

    return NextResponse.json({ status, messages });
  } catch (error) {
    console.error("GET /api/notifications/feishu-app/listen error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/feishu-app/listen?appId=xxx
 *
 * Stops the listener for the given appId.
 *
 * Returns: { success: true } or { error: "..." }
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get("appId");

    if (!appId) {
      return NextResponse.json({ error: "缺少 appId 参数" }, { status: 400 });
    }

    const stopped = await stopFeishuListener(appId);

    return NextResponse.json({ success: stopped });
  } catch (error) {
    console.error("DELETE /api/notifications/feishu-app/listen error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
