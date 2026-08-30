import { NextResponse } from "next/server";
import { getProxyTags } from "@/lib/proxy-subscriptions";

export async function GET() {
  return NextResponse.json(getProxyTags());
}
