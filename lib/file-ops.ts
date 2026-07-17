import fs from 'fs'
import path from 'path'
import os from 'os'

// Data directory priority: env var > XDG Base Directory > fallback
// Set DATA_DIR to override the default XDG location
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
export const dataDir = process.env.DATA_DIR || path.join(XDG_DATA_HOME, 'ai-subscriptions')

export function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

export function atomicWriteFile(filePath: string, data: string): void {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, filePath)
}
