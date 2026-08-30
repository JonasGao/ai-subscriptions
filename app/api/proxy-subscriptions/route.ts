import { NextRequest, NextResponse } from "next/server";
import {
  createProxySubscription,
  getProxySubscriptions,
} from "@/lib/proxy-subscriptions";

export async function GET() {
  try {
    return NextResponse.json(getProxySubscriptions());
  } catch (error) {
    console.error("GET /api/proxy-subscriptions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proxy subscriptions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const subscription = createProxySubscription(body);
    return NextResponse.json(subscription, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create proxy subscription",
      },
      { status: 400 }
    );
  }
}
