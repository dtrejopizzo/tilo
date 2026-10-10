import { apiRoute, BadRequestError, oneOf } from "@/lib/server/apiRoute"
import { listConnections, removeConnection } from "@/lib/server/connections"
import { disconnectStrava } from "@/lib/server/strava"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"

// GET → connections plus which device sources have sent data recently
export const GET = apiRoute(async ({ uid }) => {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const [conns, metrics] = await Promise.all([
    supabaseAdmin().from("connections").select("provider, external_id, account_email, display_name, scopes, status, last_sync_at, last_error").eq("user_id", uid),
    supabaseAdmin().from("daily_metrics").select("source, device, date, steps, updated_at").eq("user_id", uid).gte("date", since).order("updated_at", { ascending: false }),
  ])
  const sources = new Map<string, { source: string; device: string | null; last_date: string; last_steps: number | null; updated_at: string }>()
  for (const m of metrics.data ?? []) {
    if (!sources.has(m.source)) sources.set(m.source, { source: m.source, device: m.device, last_date: m.date, last_steps: m.steps, updated_at: m.updated_at })
  }
  return { connections: conns.data ?? [], deviceSources: [...sources.values()], active: await listConnections(undefined, uid) }
})

// DELETE ?provider=strava|google&id=
export const DELETE = apiRoute(async ({ uid, req }) => {
  const provider = oneOf(req.nextUrl.searchParams.get("provider"), ["strava", "google"] as const, "provider")
  const id = req.nextUrl.searchParams.get("id")
  if (!provider || !id) throw new BadRequestError("provider and id are required")
  if (provider === "strava") await disconnectStrava(uid, id)
  else await removeConnection(uid, provider, id)
}, { allowApiToken: false })
