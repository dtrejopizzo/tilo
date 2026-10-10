import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { env } from "../env"

// AES-256-GCM for OAuth tokens and BYO AI keys at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url)
function key(): Buffer {
  const k = Buffer.from(env.tokenKey(), "base64")
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded")
  return k
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".")
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".")
  if (version !== "v1") throw new Error("Unknown token format")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function randomToken(prefix = "", bytes = 24): string {
  return prefix + randomBytes(bytes).toString("base64url")
}
