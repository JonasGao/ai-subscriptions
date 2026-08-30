import { NextRequest, NextResponse } from "next/server";
import {
  deleteProxySubscription,
  getProxySubscriptionById,
  updateProxySubscription,
} from "@/lib/proxy-subscriptions";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const subscription = getProxySubscriptionById(params.id);
  if (!subscription)
    return NextResponse.json(
      { error: "Proxy subscription not found" },
      { status: 404 }
    );
  return NextResponse.json(subscription);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { tagNames } = body;
    const editableFields = {
      name: body.name,
      monthlyPrice: body.monthlyPrice,
      expirationDate: body.expirationDate,
      website: body.website,
      notes: body.notes,
      status: body.status,
    };
    const updates = Object.fromEntries(
      Object.entries(editableFields).filter(
        ([key, value]) =>
          value !== undefined ||
          (key === "expirationDate" &&
            Object.prototype.hasOwnProperty.call(body, "expirationDate"))
      )
    ) as Parameters<typeof updateProxySubscription>[1];
    const subscription = updateProxySubscription(params.id, updates, tagNames);
    if (!subscription)
      return NextResponse.json(
        { error: "Proxy subscription not found" },
        { status: 404 }
      );
    return NextResponse.json(subscription);
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
            : "Failed to update proxy subscription",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!deleteProxySubscription(params.id)) {
    return NextResponse.json(
      { error: "Proxy subscription not found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true });
}
