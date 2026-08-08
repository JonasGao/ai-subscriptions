import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionById, getProviders } from "@/lib/db";
import { decryptCredentials } from "@/lib/encryption";
import {
  usageHandlers,
  resolveUsageHandlerKey,
  resolveUsageApiUrl,
} from "@/lib/providers";

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

    if (subscription.subscriptionType !== "recurring") {
      return NextResponse.json(
        { error: "Usage query is only supported for recurring subscriptions" },
        { status: 400 }
      );
    }

    const providers = getProviders();
    const providerConfig = providers.find(
      (p) => p.id === subscription.provider
    );
    const usageApiUrl = providerConfig
      ? resolveUsageApiUrl(providerConfig, subscription.planId)
      : undefined;
    if (!usageApiUrl) {
      return NextResponse.json(
        { error: `Usage query not supported for ${subscription.provider}` },
        { status: 400 }
      );
    }

    const handlerKey = resolveUsageHandlerKey(subscription);
    const handler = usageHandlers[handlerKey];
    if (!handler) {
      return NextResponse.json(
        { error: "Unsupported provider" },
        { status: 400 }
      );
    }

    if (!subscription.credentials) {
      return NextResponse.json(
        { error: "Credentials are not configured for this subscription" },
        { status: 400 }
      );
    }

    const credentials = decryptCredentials(subscription.credentials);

    try {
      const result = await handler.fetchUsage(credentials);
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
