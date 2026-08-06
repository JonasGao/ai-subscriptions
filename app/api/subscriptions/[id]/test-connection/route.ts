import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionById, getProviders } from "@/lib/db";
import { usageHandlers, balanceHandlers } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function POST(
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

    const body = await request.json();
    const credentials = body.credentials as Record<string, string>;

    if (
      !credentials ||
      typeof credentials !== "object" ||
      Object.keys(credentials).length === 0
    ) {
      return NextResponse.json(
        { error: "Credentials are required" },
        { status: 400 }
      );
    }

    const providers = getProviders();
    const providerConfig = providers.find(
      (p) => p.id === subscription.provider
    );

    // Try usage handler first, then balance handler
    const usageHandler = usageHandlers[subscription.provider];
    const balanceHandler = balanceHandlers[subscription.provider];

    if (usageHandler) {
      const result = await usageHandler.testConnection(credentials);
      return NextResponse.json(result);
    }

    if (balanceHandler) {
      const result = await balanceHandler.testConnection(credentials);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: `Test connection not supported for ${subscription.provider}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/subscriptions/[id]/test-connection error:", error);
    return NextResponse.json(
      { error: "Failed to test connection" },
      { status: 500 }
    );
  }
}
