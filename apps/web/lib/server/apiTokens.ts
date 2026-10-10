import type { ApiTokenInfo } from "@tilo/core/apiTypes"
import { supabaseAdmin } from "../supabase/server"
import { randomToken, sha256 } from "./crypto"

// Personal API tokens (VSCode, local MCP, iOS Shortcut) and MCP OAuth access tokens.
// Only the SHA-256 hash is stored, as the row id.
export const API_TOKEN_PREFIX = "tilo_"

type Kind = ApiTokenInfo["kind"]

export async function createApiToken(
  userId: string,
  name: string,
  kind: Kind = "personal",
  opts: { clientId?: string; expiresAt?: Date } = {},
): Promise<{ token: string; info: ApiTokenInfo }> {
  const token = randomToken(API_TOKEN_PREFIX)
  const preview = `${token.slice(0, 9)}…${token.slice(-4)}`
  const { error } = await supabaseAdmin().from("api_tokens").insert({
    id: sha256(token),
    user_id: userId,
    name: name.slice(0, 60),
    preview,
    kind,
    client_id: opts.clientId ?? null,
    expires_at: opts.expiresAt?.toISOString() ?? null,
  })
  if (error) throw new Error(`Couldn't create token: ${error.message}`)
  return { token, info: { id: sha256(token), name, preview, kind, createdAt: new Date().toISOString(), lastUsedAt: null } }
}

export async function listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
  const { data, error } = await supabaseAdmin()
    .from("api_tokens")
    .select("id, name, preview, kind, created_at, last_used_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, preview: t.preview, kind: t.kind, createdAt: t.created_at, lastUsedAt: t.last_used_at }))
}

export async function revokeApiToken(userId: string, id: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("api_tokens").delete().eq("id", id).eq("user_id", userId).select("id")
  return (data?.length ?? 0) > 0
}

// Returns the owner's uid, or null if the token is unknown or expired
export async function verifyApiToken(token: string): Promise<string | null> {
  const id = sha256(token)
  const { data, error } = await supabaseAdmin().from("api_tokens").select("user_id, expires_at, last_used_at").eq("id", id).maybeSingle()
  if (error) throw new Error(`Token lookup failed: ${error.message}`)
  if (!data || (data.expires_at && Date.parse(data.expires_at) < Date.now())) return null
  // Throttle last_used_at writes to once a minute
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 60_000) {
    void supabaseAdmin().from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", id).then(() => {})
  }
  return data.user_id as string
}
