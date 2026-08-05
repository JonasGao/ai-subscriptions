import { NextRequest, NextResponse } from "next/server";
import { lookupFeishuUserByPhone } from "@/lib/notifications/feishu-helpers";
import { resolveFeishuCredentials } from "@/lib/notifications/feishu-credentials";
import { parseJsonBody } from "@/lib/notifications/channel-validate";

/**
 * POST /api/notifications/feishu-app/lookup-user
 *
 * Looks up users by phone number to get their open_id.
 *
 * Body:
 * - appId + appSecret (direct credentials)
 * - OR channelId (uses stored appSecret)
 * - mobiles: string[] (phone numbers in international format, e.g., ["+8613800138000"])
 *
 * Returns: { user_list: [{user_id: {open_id, ...}, mobile?, email?}] }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const creds = resolveFeishuCredentials(body);

    const mobiles = body.mobiles;
    if (!Array.isArray(mobiles) || mobiles.length === 0) {
      return NextResponse.json(
        { error: "mobiles 必须是包含至少一个手机号的数组" },
        { status: 400 }
      );
    }

    // Validate all entries are strings
    for (const m of mobiles) {
      if (typeof m !== "string" || m.trim().length === 0) {
        return NextResponse.json(
          { error: "mobiles 数组中的每个元素必须是非空字符串" },
          { status: 400 }
        );
      }
    }

    const result = await lookupFeishuUserByPhone(
      creds.appId,
      creds.appSecret,
      mobiles.map((m: unknown) => (m as string).trim())
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "POST /api/notifications/feishu-app/lookup-user error:",
      error
    );
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
