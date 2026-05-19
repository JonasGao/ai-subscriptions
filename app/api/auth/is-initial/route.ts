import { NextResponse } from "next/server"
import { isInitialPassword } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
  const isInitial = isInitialPassword()
  return NextResponse.json({ isInitial })
}