import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionById, getProviders } from "@/lib/db";
import { decryptCredentials } from "@/lib/encryption";
import { balanceHandlers } from "@/lib/providers";

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

    const providers = getProviders();
    const providerConfig = providers.find(
      (p) => p.id === subscription.provider
    );
    if (!providerConfig?.balanceApiUrl) {
      return NextResponse.json(
        { error: `Balance query not supported for ${subscription.provider}` },
        { status: 400 }
      );
    }

    const handler = balanceHandlers[subscription.provider];
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
      const result = await handler.fetchBalance(credentials);
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (handlerError) {
      const message =
        handlerError instanceof Error
          ? handlerError.message
          : "Balance query failed";
      console.error("Balance handler error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Balance query timed out" },
        { status: 504 }
      );
    }
    console.error("GET /api/subscriptions/[id]/balance error:", error);
    return NextResponse.json(
      { error: "Failed to query balance" },
      { status: 500 }
    );
  }
}
