import { NextResponse } from "next/server";
import { getProxyTags } from "@/lib/proxy-subscriptions";

// Proxy tags are mutable JSON-backed data; never serve a build-time snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getProxyTags());
}
