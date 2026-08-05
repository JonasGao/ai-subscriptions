import { NextRequest, NextResponse } from "next/server";
import { listFeishuChats } from "@/lib/notifications/feishu-helpers";
import { resolveFeishuCredentials } from "@/lib/notifications/feishu-credentials";
import { parseJsonBody } from "@/lib/notifications/channel-validate";

/**
 * POST /api/notifications/feishu-app/chats
 *
 * Lists chats the bot is a member of.
 *
 * Body:
 * - appId + appSecret (direct credentials)
 * - OR channelId (uses stored appSecret, optional appId override)
 * - Optional: page_size, page_token for pagination
 *
 * Returns: { items: [{chat_id, name, ...}], has_more, page_token }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const creds = resolveFeishuCredentials(body);

    const page_size =
      typeof body.page_size === "number" ? body.page_size : undefined;
    const page_token =
      typeof body.page_token === "string" ? body.page_token : undefined;

    const result = await listFeishuChats(creds.appId, creds.appSecret, {
      page_size,
      page_token,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/notifications/feishu-app/chats error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
