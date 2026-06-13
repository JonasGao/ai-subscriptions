import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { authConfig } from "./auth.config"
import { ensureDataDir, atomicWriteFile } from "./file-ops"

if (!process.env.NEXTAUTH_SECRET) {
  console.warn("WARNING: NEXTAUTH_SECRET is not set. Using a random secret. Sessions will be invalidated on restart.")
  process.env.NEXTAUTH_SECRET = crypto.randomBytes(32).toString("hex")
}

const dataDir = path.join(process.cwd(), "data")
const authFile = path.join(dataDir, "auth.json")

interface AuthData {
  username: string
  passwordHash: string
  createdAt: string
  updatedAt: string
  isInitial: boolean
}

interface RateLimitEntry {
  count: number
  firstAttempt: number
}

const loginAttempts = new Map<string, RateLimitEntry>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
    return true
  }

  if (entry.count >= MAX_ATTEMPTS) return false

  entry.count++
  return true
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

    atomicWriteFile(authFile, JSON.stringify(initialData, null, 2))
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
  if (newPassword.length < 6) {
    throw new Error("密码长度至少6位")
  }

  const authData = getAuthData()

  const isValid = bcrypt.compareSync(oldPassword, authData.passwordHash)
  if (!isValid) {
    return false
  }

  authData.passwordHash = bcrypt.hashSync(newPassword, 10)
  authData.updatedAt = new Date().toISOString()
  authData.isInitial = false

  atomicWriteFile(authFile, JSON.stringify(authData, null, 2))
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
      async authorize(credentials, request) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }

        const ip = request?.headers?.get('x-forwarded-for') || 'unknown'
        if (!checkRateLimit(ip)) {
          console.warn(`Rate limit exceeded for IP: ${ip}`)
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

        loginAttempts.delete(ip)

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
