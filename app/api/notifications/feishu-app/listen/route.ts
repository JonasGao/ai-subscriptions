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
 * - Optional: ttl_seconds (auto-stop timeout, default 120)
 *
 * Returns: { appId, listenId, startedAt, messageCount, stopped, ttlSeconds }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const creds = resolveFeishuCredentials(body);

    const ttl_seconds =
      typeof body.ttl_seconds === "number" ? body.ttl_seconds : undefined;

    const status = await startFeishuListener(creds.appId, creds.appSecret, {
      ttlSeconds: ttl_seconds,
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
 * GET /api/notifications/feishu-app/listen?listenId=xxx
 *
 * Polls the listener status and retrieves received messages.
 * Accepts either appId or listenId (listenId takes precedence).
 *
 * Returns: { status: {...}, messages: [...] }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listenId = searchParams.get("listenId");
    const appId = searchParams.get("appId");

    const id = listenId ?? appId;
    if (!id) {
      return NextResponse.json(
        { error: "缺少 listenId 或 appId 参数" },
        { status: 400 }
      );
    }

    const status = getListenerStatus(id);
    if (!status) {
      // 404 treated as "no listener or tombstone expired" — frontend stops polling
      return NextResponse.json(
        { error: `没有找到监听器(id=${id}),可能已停止或已过期` },
        { status: 404 }
      );
    }

    const messages = getListenerMessages(id);

    return NextResponse.json({ status, messages });
  } catch (error) {
    console.error("GET /api/notifications/feishu-app/listen error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/feishu-app/listen?listenId=xxx
 * DELETE /api/notifications/feishu-app/listen?appId=xxx
 *
 * Stops the listener for the given listenId or appId.
 * Prefers listenId (the snapshot from start response) over appId to avoid
 * issues where the user has changed the form's appId after starting.
 *
 * Returns: { success: true } or { error: "..." }
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listenId = searchParams.get("listenId");
    const appId = searchParams.get("appId");

    const id = listenId ?? appId;
    if (!id) {
      return NextResponse.json(
        { error: "缺少 listenId 或 appId 参数" },
        { status: 400 }
      );
    }

    const stopped = await stopFeishuListener(id);

    return NextResponse.json({ success: stopped });
  } catch (error) {
    console.error("DELETE /api/notifications/feishu-app/listen error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
