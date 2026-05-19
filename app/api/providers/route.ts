import { NextResponse } from "next/server"
import { getProviders } from "@/lib/db"

export async function GET() {
  const providers = getProviders()
  return NextResponse.json(providers)
}