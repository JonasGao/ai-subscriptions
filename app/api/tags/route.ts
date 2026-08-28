import { NextResponse } from "next/server";
import { getTags } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(getTags());
  } catch (error) {
    console.error("GET /api/tags error:", error);
    return NextResponse.json(
      { error: "Failed to fetch tags" },
      { status: 500 }
    );
  }
}
