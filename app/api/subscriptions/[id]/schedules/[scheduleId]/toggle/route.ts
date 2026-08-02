import { NextRequest, NextResponse } from "next/server";
import { toggleScheduleExhausted } from "@/lib/db";
import { Subscription } from "@/lib/types";

function stripApiKey(sub: Subscription) {
  const { apiKey, ...rest } = sub;
  return rest;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; scheduleId: string } }
) {
  try {
    const body = await request.json();

    // Validate request body
    if (typeof body.exhausted !== "boolean") {
      return NextResponse.json(
        { error: 'Invalid request body. "exhausted" must be a boolean' },
        { status: 400 }
      );
    }

    const updatedSubscription = toggleScheduleExhausted(
      params.id,
      params.scheduleId,
      body.exhausted
    );

    if (!updatedSubscription) {
      return NextResponse.json(
        { error: "Subscription or schedule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(stripApiKey(updatedSubscription));
  } catch (error) {
    console.error(
      "POST /api/subscriptions/[id]/schedules/[scheduleId]/toggle error:",
      error
    );
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to toggle schedule exhausted flag" },
      { status: 500 }
    );
  }
}
