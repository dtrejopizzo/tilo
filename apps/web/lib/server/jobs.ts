// Scheduled work (Vercel Cron → /api/cron/daily): sync every connection, refresh energy and
// recalibrate expenditure weekly from intake vs. weight trend.
import { adaptiveCalibration } from "@tilo/core/energy"
import { supabaseAdmin } from "../supabase/server"
import { listConnections } from "./connections"
import { gmailSnapshot, hasFeature, syncGoogleHealth } from "./google"
import { ensureStravaWebhook, syncStrava } from "./strava"
import { ServerTiloApi } from "./tiloServer"

export function localToday(timezone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
}

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

// How long device data may sit before a sync is worth a round trip to the provider
export const STALE_MS = 10 * 60_000

// Frequent pass (every 15 minutes): device data for every connection that hasn't synced lately.
// Webhooks (Strava, Google Health) usually get there first; this catches anything they missed.
export async function runSync(): Promise<Record<string, number | string>> {
  const stats: Record<string, number | string> = { synced: 0, failed: 0, skipped: 0, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" }
  const conns = (await listConnections()).filter((c) => c.provider === "strava" || hasFeature(c.scopes, "health"))
  const stale = conns.filter((c) => !c.last_sync_at || Date.now() - Date.parse(c.last_sync_at) > STALE_MS)
  stats.skipped = conns.length - stale.length
  // A few at a time: each sync is several provider requests
  for (let i = 0; i < stale.length; i += 5) {
    const results = await Promise.allSettled(
      stale.slice(i, i + 5).map((c) => (c.provider === "strava" ? syncStrava(c.user_id, c.external_id, 2) : syncGoogleHealth(c.user_id, c.external_id, 2))),
    )
    for (const r of results) {
      if (r.status === "fulfilled") (stats.synced as number)++
      else {
        ;(stats.failed as number)++
        console.error("[sync]", r.reason)
      }
    }
  }
  return stats
}

export async function runDaily(): Promise<Record<string, number>> {
  const db = supabaseAdmin()
  const stats = { connections: 0, failed: 0, energyDays: 0, calibrated: 0 }

  await ensureStravaWebhook().then((r) => r === "created" && console.log("[cron] Strava webhook subscribed")).catch((e) => console.error("[cron] Strava webhook:", e))

  const { data: profiles } = await db.from("profiles").select("id, timezone")
  const tz = new Map((profiles ?? []).map((p) => [p.id as string, (p.timezone as string) ?? "UTC"]))

  for (const c of await listConnections()) {
    const today = localToday(tz.get(c.user_id) ?? "UTC")
    try {
      if (c.provider === "strava") await syncStrava(c.user_id, c.external_id, 3)
      if (c.provider === "google") {
        if (hasFeature(c.scopes, "gmail")) await gmailSnapshot(c.user_id, c.external_id, c.account_email ?? "", today, today)
        if (hasFeature(c.scopes, "health")) await syncGoogleHealth(c.user_id, c.external_id, 3)
      }
      stats.connections++
    } catch (error) {
      stats.failed++
      console.error(`[cron] ${c.provider} ${c.user_id}:`, error)
    }
  }

  // Energy for today and yesterday of everyone active this week
  const since = addDays(new Date().toISOString().slice(0, 10), -7)
  const { data: active } = await db.from("daily_summary").select("user_id").gte("date", since)
  const users = [...new Set((active ?? []).map((r) => r.user_id as string))]
  for (const uid of users) {
    const today = localToday(tz.get(uid) ?? "UTC")
    const api = new ServerTiloApi(uid)
    for (const d of [addDays(today, -1), today]) {
      await api.getDay(d).then(() => stats.energyDays++).catch((e) => console.error(`[cron] energy ${uid}:`, e))
    }
    if (new Date().getUTCDay() === 1) {
      if (await recalibrate(uid, today).catch(() => false)) stats.calibrated++
    }
  }
  return stats
}

// Weekly: compare the model's expenditure with what intake and the weight trend imply
export async function recalibrate(userId: string, today: string): Promise<boolean> {
  const db = supabaseAdmin()
  const from = addDays(today, -21)
  const to = addDays(today, -1)
  const [energy, summaries, weights, settings] = await Promise.all([
    db.from("energy_days").select("date, total, calibration").eq("user_id", userId).gte("date", from).lte("date", to),
    db.from("daily_summary").select("date, kcal_in, meals_count").eq("user_id", userId).gte("date", from).lte("date", to),
    db.from("weight_logs").select("date, kg").eq("user_id", userId).gte("date", addDays(from, -14)).lte("date", to),
    db.from("settings").select("data").eq("user_id", userId).maybeSingle(),
  ])
  const intake = new Map((summaries.data ?? []).map((s) => [s.date as string, s.meals_count > 0 ? Number(s.kcal_in) : null]))
  const days = (energy.data ?? [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date as string, modelKcal: Number(e.total) / Number(e.calibration || 1), intakeKcal: intake.get(e.date) ?? null }))
  const current = Number((settings.data?.data as { calibration?: number } | undefined)?.calibration ?? 1)
  const result = adaptiveCalibration(days, (weights.data ?? []).map((w) => ({ date: w.date, kg: Number(w.kg) })), current)
  if (result.observedTdee == null) return false
  await db.from("settings").upsert({
    user_id: userId,
    data: { ...(settings.data?.data ?? {}), calibration: result.factor, calibration_info: { ...result, at: today } },
    updated_at: new Date().toISOString(),
  })
  return true
}
