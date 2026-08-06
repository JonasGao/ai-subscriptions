import { NextRequest, NextResponse } from "next/server";
import { setStatusManually } from "@/lib/db";
import { SubscriptionStatus } from "@/lib/types";
import { stripCredentials } from "@/lib/api-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    // Validate status
    const validStatuses: SubscriptionStatus[] = [
      "active",
      "paused",
      "cancelled",
    ];
    if (!body.status || !validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: active, paused, cancelled" },
        { status: 400 }
      );
    }

    const updatedSubscription = setStatusManually(params.id, body.status);

    if (!updatedSubscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(stripCredentials(updatedSubscription));
  } catch (error) {
    console.error("POST /api/subscriptions/[id]/status error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update subscription status" },
      { status: 500 }
    );
  }
}
