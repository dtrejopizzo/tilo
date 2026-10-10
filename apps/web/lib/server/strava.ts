// Strava: OAuth, webhook-driven sync and backfill. Garmin, Coros, Wahoo, Polar and Suunto users
// get here too by turning on their device's automatic upload to Strava.
import type { IngestPayload } from "@tilo/core/apiTypes"
import { env } from "../env"
import { supabaseAdmin } from "../supabase/server"
import { listConnections, loadTokens, makeState, markSynced, saveConnection, saveTokens } from "./connections"
import { ingest } from "./ingest"

const API = "https://www.strava.com/api/v3"

export function stravaAuthorizeUrl(userId: string, returnTo = "/"): string {
  const params = new URLSearchParams({
    client_id: env.stravaClientId(),
    redirect_uri: `${env.appUrl()}/api/connect/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state: makeState(userId, { r: returnTo }),
  })
  return `https://www.strava.com/oauth/authorize?${params}`
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.stravaClientId(), client_secret: env.stravaClientSecret(), ...body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Strava token: ${data.message ?? res.status}`)
  return data as { access_token: string; refresh_token: string; expires_at: number; athlete?: { id: number; firstname?: string; lastname?: string } }
}

export async function connectStrava(userId: string, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code" })
  const athleteId = String(t.athlete!.id)
  await saveConnection(
    userId,
    "strava",
    athleteId,
    { displayName: [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(" ") || null, scopes: ["activity:read_all"] },
    { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(t.expires_at * 1000) },
  )
  // First import: the last 30 days
  await syncStrava(userId, athleteId, 30).catch((e) => console.error("[strava] first sync failed:", e))
  return athleteId
}

async function accessToken(userId: string, athleteId: string): Promise<string> {
  const tokens = await loadTokens(userId, "strava", athleteId)
  if (!tokens) throw new Error("Strava not connected")
  if (tokens.expiresAt && tokens.expiresAt.getTime() > Date.now() + 120_000) return tokens.accessToken
  const t = await tokenRequest({ refresh_token: tokens.refreshToken!, grant_type: "refresh_token" })
  await saveTokens(userId, "strava", athleteId, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(t.expires_at * 1000) })
  return t.access_token
}

interface StravaActivity {
  id: number
  name: string
  sport_type?: string
  type: string
  start_date: string
  start_date_local: string
  elapsed_time: number
  moving_time: number
  distance?: number
  calories?: number
  kilojoules?: number
  average_heartrate?: number
  max_heartrate?: number
  total_elevation_gain?: number
  device_name?: string
}

function toIngest(a: StravaActivity): NonNullable<IngestPayload["activities"]>[number] & { _localDate: string } {
  const start = a.start_date
  const end = new Date(Date.parse(start) + a.elapsed_time * 1000).toISOString()
  return {
    external_id: String(a.id),
    type: a.sport_type ?? a.type,
    name: a.name,
    start_at: start,
    end_at: end,
    duration_s: a.moving_time || a.elapsed_time,
    distance_m: a.distance || undefined,
    // Strava calories are gross (include resting); kilojoules of work ≈ kcal burned on rides
    kcal: a.calories || a.kilojoules || undefined,
    kcal_is_net: false,
    avg_hr: a.average_heartrate,
    max_hr: a.max_heartrate,
    elevation_m: a.total_elevation_gain,
    _localDate: a.start_date_local.slice(0, 10),
  }
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Strava ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export async function syncStrava(userId: string, athleteId: string, days = 3) {
  try {
    const token = await accessToken(userId, athleteId)
    const after = Math.floor(Date.now() / 1000) - days * 86400
    const list = await get<StravaActivity[]>(token, `/athlete/activities?after=${after}&per_page=100`)
    // The list has no calories for runs; fetch details for a few (rate limit: 100 req / 15 min)
    const detailed = await Promise.all(
      list.map(async (a, i) => (a.calories == null && a.kilojoules == null && i < 15 ? get<StravaActivity>(token, `/activities/${a.id}`).catch(() => a) : a)),
    )
    const device = detailed.find((a) => a.device_name)?.device_name
    await ingest(userId, { source: "strava", device: device ?? "Strava", activities: detailed.map(toIngest) })
    await markSynced(userId, "strava", athleteId)
    return detailed.length
  } catch (error) {
    await markSynced(userId, "strava", athleteId, String(error))
    throw error
  }
}

// Webhook event: https://developers.strava.com/docs/webhooks/
export async function handleStravaEvent(event: { object_type: string; aspect_type: string; object_id: number; owner_id: number; updates?: Record<string, string> }) {
  const athleteId = String(event.owner_id)
  const [conn] = (await listConnections("strava")).filter((c) => c.external_id === athleteId)
  if (!conn) return
  if (event.object_type === "athlete" && event.updates?.authorized === "false") {
    await supabaseAdmin().from("connections").update({ status: "revoked" }).eq("provider", "strava").eq("external_id", athleteId)
    return
  }
  if (event.object_type !== "activity") return
  if (event.aspect_type === "delete") {
    await supabaseAdmin().from("activities").delete().eq("user_id", conn.user_id).eq("source", "strava").eq("external_id", String(event.object_id))
    return
  }
  const token = await accessToken(conn.user_id, athleteId)
  const a = await get<StravaActivity>(token, `/activities/${event.object_id}`)
  await ingest(conn.user_id, { source: "strava", device: a.device_name ?? "Strava", activities: [toIngest(a)] })
  await markSynced(conn.user_id, "strava", athleteId)
}

export async function disconnectStrava(userId: string, athleteId: string) {
  const tokens = await loadTokens(userId, "strava", athleteId)
  if (tokens) {
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }).catch(() => {})
  }
  await supabaseAdmin().from("connections").delete().eq("user_id", userId).eq("provider", "strava").eq("external_id", athleteId)
}
