// OAuth connections: tokens are AES-GCM encrypted in connection_secrets (service role only).
import { supabaseAdmin } from "../supabase/server"
import { decrypt, encrypt } from "./crypto"

export type Provider = "strava" | "google" | "google_health"

export interface StoredTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

export async function saveConnection(
  userId: string,
  provider: Provider,
  externalId: string,
  info: { accountEmail?: string | null; displayName?: string | null; scopes?: string[] },
  tokens: StoredTokens,
) {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from("connections")
    .select("scopes")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .maybeSingle()
  const scopes = [...new Set([...(existing?.scopes ?? []), ...(info.scopes ?? [])])]
  const { error } = await db.from("connections").upsert(
    {
      user_id: userId, provider, external_id: externalId, account_email: info.accountEmail ?? null,
      display_name: info.displayName ?? null, scopes, status: "active", last_error: null,
    },
    { onConflict: "user_id,provider,external_id" },
  )
  if (error) throw new Error(`connections: ${error.message}`)
  await saveTokens(userId, provider, externalId, tokens)
}

export async function saveTokens(userId: string, provider: Provider, externalId: string, tokens: StoredTokens) {
  const db = supabaseAdmin()
  const { data: current } = await db
    .from("connection_secrets")
    .select("refresh_token")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .maybeSingle()
  const { error } = await db.from("connection_secrets").upsert(
    {
      user_id: userId, provider, external_id: externalId,
      access_token: encrypt(tokens.accessToken),
      // Google only returns a refresh token on first consent; keep the old one
      refresh_token: tokens.refreshToken ? encrypt(tokens.refreshToken) : current?.refresh_token ?? null,
      expires_at: tokens.expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,external_id" },
  )
  if (error) throw new Error(`connection_secrets: ${error.message}`)
}

export async function loadTokens(userId: string, provider: Provider, externalId: string): Promise<StoredTokens | null> {
  const { data } = await supabaseAdmin()
    .from("connection_secrets")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .maybeSingle()
  if (!data) return null
  return {
    accessToken: decrypt(data.access_token),
    refreshToken: data.refresh_token ? decrypt(data.refresh_token) : null,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  }
}

// A second access token on the same connection, minted with fewer scopes (Google Health rejects
// tokens that also carry Gmail/Calendar). Cached until it expires, so a sync is one round trip less.
export async function loadScopedToken(userId: string, provider: Provider, externalId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("connection_secrets")
    .select("scoped_access_token, scoped_expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .maybeSingle()
  if (!data?.scoped_access_token || !data.scoped_expires_at || Date.parse(data.scoped_expires_at) < Date.now() + 120_000) return null
  return decrypt(data.scoped_access_token)
}

export async function saveScopedToken(userId: string, provider: Provider, externalId: string, token: string, expiresAt: Date) {
  await supabaseAdmin()
    .from("connection_secrets")
    .update({ scoped_access_token: encrypt(token), scoped_expires_at: expiresAt.toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("external_id", externalId)
}

export async function listConnections(provider?: Provider, userId?: string) {
  let q = supabaseAdmin().from("connections").select("user_id, provider, external_id, account_email, scopes, status, last_sync_at, health_user_id").eq("status", "active")
  if (provider) q = q.eq("provider", provider)
  if (userId) q = q.eq("user_id", userId)
  const { data } = await q
  return (data ?? []) as { user_id: string; provider: Provider; external_id: string; account_email: string | null; scopes: string[]; status: string; last_sync_at: string | null; health_user_id: string | null }[]
}

export async function markSynced(userId: string, provider: Provider, externalId: string, error?: string) {
  await supabaseAdmin()
    .from("connections")
    .update(error ? { status: /invalid_grant|revoked|401/.test(error) ? "error" : "active", last_error: error.slice(0, 500) } : { last_sync_at: new Date().toISOString(), last_error: null })
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("external_id", externalId)
}

export async function removeConnection(userId: string, provider: Provider, externalId: string) {
  await supabaseAdmin().from("connections").delete().eq("user_id", userId).eq("provider", provider).eq("external_id", externalId)
}

// Signed OAuth state: which user started the flow, and where to return
export function makeState(userId: string, extra: Record<string, string> = {}): string {
  return encrypt(JSON.stringify({ u: userId, t: Date.now(), ...extra })).replace(/\./g, "~")
}

export function readState(state: string | null): { u: string; t: number; [k: string]: unknown } {
  if (!state) throw new Error("Missing state")
  const parsed = JSON.parse(decrypt(state.replace(/~/g, ".")))
  if (Date.now() - parsed.t > 15 * 60_000) throw new Error("This link expired, start again")
  return parsed
}
