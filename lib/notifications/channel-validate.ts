import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationChannelType } from "@/lib/types";

/**
 * The three notification channel types supported by the system. Kept as a
 * runtime array so routes can validate incoming `type` values against it.
 */
export const VALID_CHANNEL_TYPES: NotificationChannelType[] = [
  "dingtalk",
  "feishu",
  "webhook",
];

/**
 * Validates a user-supplied webhook URL. Accepts only http(s) URLs, returns
 * the trimmed string on success, null otherwise.
 */
export function safeWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Strips the signing secret from a channel before it is returned to the
 * client. `hasSecret` is returned so the UI can show a "keep / change /
 * clear" choice without ever seeing the value.
 */
export function sanitizeChannelForClient(
  channel: NotificationChannel
): Omit<NotificationChannel, "secret"> & { hasSecret: boolean } {
  const { secret, ...rest } = channel;
  return { ...rest, hasSecret: Boolean(secret) };
}

/**
 * Parses a NextRequest body as JSON. On malformed JSON, responds with
 * 400 `{ error: "Invalid JSON in request body" }` and returns
 * `{ ok: false }`. Caller returns the response directly.
 *
 * On success, returns `{ ok: true, body }`.
 */
export async function parseJsonBody(
  request: NextRequest
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 }
        ),
      };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid JSON in request body" },
          { status: 400 }
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to parse request body" },
        { status: 400 }
      ),
    };
  }
}
