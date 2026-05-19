import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import fs from "fs"
import path from "path"
import { authConfig } from "./auth.config"

const dataDir = path.join(process.cwd(), "data")
const authFile = path.join(dataDir, "auth.json")

interface AuthData {
  username: string
  passwordHash: string
  createdAt: string
  updatedAt: string
}

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function getAuthData(): AuthData {
  ensureDataDir()

  if (!fs.existsSync(authFile)) {
    const defaultPassword = "admin123"
    const passwordHash = bcrypt.hashSync(defaultPassword, 10)
    const now = new Date().toISOString()

    const initialData: AuthData = {
      username: "admin",
      passwordHash,
      createdAt: now,
      updatedAt: now
    }

    fs.writeFileSync(authFile, JSON.stringify(initialData, null, 2))
    return initialData
  }

  const fileContent = fs.readFileSync(authFile, "utf-8")
  return JSON.parse(fileContent) as AuthData
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }

        const authData = getAuthData()
        const username = credentials.username as string
        const password = credentials.password as string

        if (username !== authData.username) {
          return null
        }

        const isValid = bcrypt.compareSync(password, authData.passwordHash)

        if (!isValid) {
          return null
        }

        return {
          id: "1",
          name: authData.username,
          email: `${authData.username}@local`
        }
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
      }
      return session
    }
  }
})