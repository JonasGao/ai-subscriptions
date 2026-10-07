import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionById, getProviders } from "@/lib/db";
import { decryptCredentials } from "@/lib/encryption";
import { resolveModelsHandler, normalizeModels } from "@/lib/providers";
import { resolveModelsRequireCredentials } from "@/lib/api-url-resolver";

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

    if (!providerConfig) {
      return NextResponse.json(
        { error: `Model query not supported for ${subscription.provider}` },
        { status: 400 }
      );
    }

    const resolved = resolveModelsHandler(providerConfig, subscription.planId);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: `Model query not supported for ${subscription.provider}` },
        { status: 400 }
      );
    }

    // Public endpoints (modelsRequireCredentials: false, e.g. alibaba
    // coding-plan) answer without any stored credentials; everything else
    // requires them and routes the user to the edit dialog client-side.
    if (
      resolveModelsRequireCredentials(providerConfig, subscription.planId) &&
      !subscription.credentials
    ) {
      return NextResponse.json(
        { error: "Credentials are not configured for this subscription" },
        { status: 400 }
      );
    }

    const credentials = subscription.credentials
      ? decryptCredentials(subscription.credentials)
      : {};

    try {
      const models = await resolved.handler.fetchModels(credentials);
      const normalized = normalizeModels(models);
      return NextResponse.json(
        { models: normalized },
        {
          headers: { "Cache-Control": "no-store" },
        }
      );
    } catch (handlerError) {
      const message =
        handlerError instanceof Error
          ? handlerError.message
          : "Model query failed";
      console.error("Model handler error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Model query timed out" },
        { status: 504 }
      );
    }
    console.error("GET /api/subscriptions/[id]/models error:", error);
    return NextResponse.json(
      { error: "Failed to query models" },
      { status: 500 }
    );
  }
}
