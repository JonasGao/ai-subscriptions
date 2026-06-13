import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

function getEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || 'ai-subscriptions-secret-key-change-in-production'
  return crypto.createHash('sha256').update(secret + '-api-key-encryption').digest()
}

export function encryptApiKey(text: string): string {
  if (!text || text.includes(':')) return text
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export function decryptApiKey(encrypted: string): string {
  if (!encrypted || !encrypted.includes(':')) return encrypted
  const parts = encrypted.split(':')
  if (parts.length !== 2 || parts[0].length !== IV_LENGTH * 2) return encrypted
  const iv = Buffer.from(parts[0], 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv)
  return decipher.update(parts[1], 'hex', 'utf8') + decipher.final('utf8')
}
