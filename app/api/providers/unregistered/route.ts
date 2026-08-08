import { NextResponse } from "next/server";
import { getSubscriptions } from "@/lib/db";
import { getTools } from "@/lib/tools";
import { getUnregisteredProviderNames } from "@/lib/providers/enrichment";

export async function GET() {
  const names = getUnregisteredProviderNames(getSubscriptions(), getTools());
  return NextResponse.json(names);
}
