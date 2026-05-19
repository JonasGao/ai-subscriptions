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
  isInitial: boolean
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
      updatedAt: now,
      isInitial: true
    }

    fs.writeFileSync(authFile, JSON.stringify(initialData, null, 2))
    return initialData
  }

  const fileContent = fs.readFileSync(authFile, "utf-8")
  return JSON.parse(fileContent) as AuthData
}

export function isInitialPassword(): boolean {
  const authData = getAuthData()
  return authData.isInitial === true
}

export function changePassword(oldPassword: string, newPassword: string): boolean {
  const authData = getAuthData()
  
  const isValid = bcrypt.compareSync(oldPassword, authData.passwordHash)
  if (!isValid) {
    return false
  }
  
  if (newPassword.length < 6) {
    throw new Error("密码长度至少6位")
  }
  
  authData.passwordHash = bcrypt.hashSync(newPassword, 10)
  authData.updatedAt = new Date().toISOString()
  authData.isInitial = false
  
  fs.writeFileSync(authFile, JSON.stringify(authData, null, 2))
  return true
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
          email: `${authData.username}@local`,
          isInitial: authData.isInitial
        }
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.isInitial = user.isInitial
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.isInitial = token.isInitial as boolean
      }
      return session
    }
  }
})