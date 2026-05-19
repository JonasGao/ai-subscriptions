import type { Session } from "next-auth"
import type { NextRequest } from "next/server"

export const authConfig = {
  providers: [],
  pages: {
    signIn: "/login"
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }: { auth: Session | null; request: NextRequest }) {
      const isLoggedIn = !!auth?.user
      const isOnLoginPage = nextUrl.pathname.startsWith("/login")

      if (isOnLoginPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl))
        return true
      }

      return isLoggedIn
    }
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 7 * 24 * 60 * 60
  },
  secret: process.env.NEXTAUTH_SECRET || "ai-subscriptions-secret-key-change-in-production",
  trustHost: true
}