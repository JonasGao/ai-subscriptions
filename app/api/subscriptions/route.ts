import { NextRequest, NextResponse } from "next/server";
import { getSubscriptions, createSubscription } from "@/lib/db";
import {
  SubscriptionFormData,
  SubscriptionType,
  BillingCycle,
} from "@/lib/types";
import { normalizeNullable, validateNonNegative } from "@/lib/validation";
import { stripCredentials } from "@/lib/api-utils";

export async function GET() {
  try {
    const subscriptions = getSubscriptions().map(stripCredentials);
    return NextResponse.json(subscriptions);
  } catch (error) {
    console.error("GET /api/subscriptions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();

    // Normalize: explicit null means "clear the field" → treat as undefined.
    normalizeNullable(raw, "lowBalanceThreshold");

    const body: SubscriptionFormData = raw;

    if (!body.name || !body.category || body.price === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: name, category, price" },
        { status: 400 }
      );
    }

    if (typeof body.price !== "number" || body.price < 0) {
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

    const validTypes: SubscriptionType[] = ["recurring", "one-time"];
    if (body.subscriptionType && !validTypes.includes(body.subscriptionType)) {
      return NextResponse.json(
        {
          error:
            "Invalid subscriptionType. Must be one of: recurring, one-time",
        },
        { status: 400 }
      );
    }

    const isRecurring = body.subscriptionType === "recurring";
    if (isRecurring) {
      if (!body.startDate || !body.renewalDate) {
        return NextResponse.json(
          {
            error:
              "startDate and renewalDate are required for recurring subscriptions",
          },
          { status: 400 }
        );
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (
        !dateRegex.test(body.startDate) ||
        !dateRegex.test(body.renewalDate)
      ) {
        return NextResponse.json(
          { error: "Dates must be in YYYY-MM-DD format" },
          { status: 400 }
        );
      }

      if (!body.billingCycle) {
        return NextResponse.json(
          { error: "billingCycle is required for recurring subscriptions" },
          { status: 400 }
        );
      }

      const validBillingCycles: BillingCycle[] = ["monthly", "yearly"];
      if (!validBillingCycles.includes(body.billingCycle)) {
        return NextResponse.json(
          { error: "Invalid billingCycle. Must be one of: monthly, yearly" },
          { status: 400 }
        );
      }
    }

    const newSubscription = createSubscription({
      name: body.name,
      category: body.category,
      provider: body.provider || "other",
      providerCustom: body.providerCustom,
      subscriptionType: body.subscriptionType || "recurring",
      billingCycle: body.billingCycle,
      price: body.price,
      startDate: body.startDate,
      renewalDate: body.renewalDate,
      status: body.status || "active",
      notes: body.notes,
      credentials: body.credentials
        ? JSON.stringify(body.credentials)
        : undefined,
      balance: body.balance,
      // normalizeNullable above converts explicit null → undefined, so the
      // stored value is always `number | undefined` (Subscription type
      // doesn't admit null). The `?? undefined` narrows the TS type to
      // match what we've established at runtime.
      lowBalanceThreshold: body.lowBalanceThreshold ?? undefined,
      resetSchedules: body.resetSchedules,
    });

    return NextResponse.json(stripCredentials(newSubscription), {
      status: 201,
    });
  } catch (error) {
    console.error("POST /api/subscriptions error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500 }
    );
  }
}
