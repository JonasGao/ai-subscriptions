import { NextResponse } from "next/server";
import { getProviders, getSubscriptions } from "@/lib/db";
import { getTools } from "@/lib/tools";
import { enrichProviders } from "@/lib/providers/enrichment";

export async function GET() {
  const providers = enrichProviders(
    getProviders(),
    getSubscriptions(),
    getTools()
  );
  return NextResponse.json(providers);
}
