import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionById } from "@/lib/db";
import { decryptCredentials } from "@/lib/encryption";
import { resolveUsageHandler } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const subscription = getSubscriptionById(params.id);

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    const resolved = resolveUsageHandler(subscription);
    if (!resolved.ok) {
      const errorMap: Record<
        typeof resolved.reason,
        { message: string; status: number }
      > = {
        "not-recurring": {
          message: "Usage query is only supported for recurring subscriptions",
          status: 400,
        },
        "no-usage-api-url": {
          message: `Usage query not supported for ${subscription.provider}`,
          status: 400,
        },
        "no-handler": {
          message: "Unsupported provider",
          status: 400,
        },
      };
      const { message, status } = errorMap[resolved.reason];
      return NextResponse.json({ error: message }, { status });
    }

    if (!subscription.credentials) {
      return NextResponse.json(
        { error: "Credentials are not configured for this subscription" },
        { status: 400 }
      );
    }

    const credentials = decryptCredentials(subscription.credentials);

    try {
      const result = await resolved.handler.fetchUsage(credentials);
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (handlerError) {
      const message =
        handlerError instanceof Error
          ? handlerError.message
          : "Usage query failed";
      console.error("Usage handler error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Usage query timed out" },
        { status: 504 }
      );
    }
    console.error("GET /api/subscriptions/[id]/usage error:", error);
    return NextResponse.json(
      { error: "Failed to query usage" },
      { status: 500 }
    );
  }
}
