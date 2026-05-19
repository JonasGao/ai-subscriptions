import NextAuth from "next-auth"

declare module "next-auth" {
  interface User {
    isInitial?: boolean
  }
  
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      isInitial?: boolean
    }
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string
    isInitial?: boolean
  }
}