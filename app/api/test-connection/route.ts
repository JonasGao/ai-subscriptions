import { NextRequest, NextResponse } from "next/server";
import { usageHandlers, balanceHandlers } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, credentials } = body as {
      provider: string;
      credentials: Record<string, string>;
    };

    if (!provider) {
      return NextResponse.json(
        { error: "Provider is required" },
        { status: 400 }
      );
    }

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

    const usageHandler = usageHandlers[provider];
    const balanceHandler = balanceHandlers[provider];

    if (usageHandler) {
      const result = await usageHandler.testConnection(credentials);
      return NextResponse.json(result);
    }

    if (balanceHandler) {
      const result = await balanceHandler.testConnection(credentials);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: `Test connection not supported for ${provider}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/test-connection error:", error);
    return NextResponse.json(
      { error: "Failed to test connection" },
      { status: 500 }
    );
  }
}
