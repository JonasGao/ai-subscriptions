import { NextRequest, NextResponse } from "next/server";
import {
  getSubscriptionById,
  updateSubscription,
  deleteSubscription,
} from "@/lib/db";
import { SubscriptionStatus } from "@/lib/types";
import { normalizeNullable, validateNonNegative } from "@/lib/validation";
import { stripCredentials } from "@/lib/api-utils";

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

    return NextResponse.json(stripCredentials(subscription));
  } catch (error) {
    console.error("GET /api/subscriptions/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    // Normalize: explicit null means "clear the field" → undefined so
    // updateSubscription's spread overwrites any previously stored value.
    normalizeNullable(body, "lowBalanceThreshold");

    // Validate price if provided
    if (
      body.price !== undefined &&
      (typeof body.price !== "number" || body.price < 0)
    ) {
      return NextResponse.json(
        { error: "Price must be a non-negative number" },
        { status: 400 }
      );
    }

    const thresholdError = validateNonNegative(
      body.lowBalanceThreshold,
      "lowBalanceThreshold"
    );
    if (thresholdError) {
      return NextResponse.json({ error: thresholdError }, { status: 400 });
    }

    // Validate status if provided
    const validStatuses: SubscriptionStatus[] = [
      "active",
      "paused",
      "cancelled",
    ];
    if (body.status !== undefined && !validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: active, paused, cancelled" },
        { status: 400 }
      );
    }

    if (!body.credentials || Object.keys(body.credentials).length === 0) {
      delete body.credentials;
    } else {
      body.credentials = JSON.stringify(body.credentials);
    }

    const updatedSubscription = updateSubscription(params.id, body);

    if (!updatedSubscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(stripCredentials(updatedSubscription));
  } catch (error) {
    console.error("PUT /api/subscriptions/[id] error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to update subscription" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = deleteSubscription(params.id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/subscriptions/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete subscription" },
      { status: 500 }
    );
  }
}
