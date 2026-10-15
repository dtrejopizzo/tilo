// Device data from any source → daily_metrics, activities (deduplicated across sources) and weight_logs.
// Accepts Tilo's own format (iOS Shortcut, Android companion, Strava sync) and the JSON that the
// "Health Auto Export" iOS app posts, so iPhone users can sync with zero setup beyond pasting a URL.
import type { IngestPayload, IngestResult, MetricSource } from "@tilo/core/apiTypes"
import { dedupeActivities, normaliseActivityType, type ActivityLike } from "@tilo/core/sources"
export { fromHealthAutoExport } from "@tilo/core/ingestFormats"
import { supabaseAdmin } from "../supabase/server"
import { BadRequestError } from "./apiRoute"
import { ServerTiloApi } from "./tiloServer"

export function localDateIn(iso: string, timezone: string): string {
  // Strings like "2026-10-08 07:10:00 -0300" already carry the local date
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(iso)) return iso.slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

// ---------- shared ----------

export async function ingest(userId: string, payload: IngestPayload): Promise<IngestResult> {
  const db = supabaseAdmin()
  const sources: MetricSource[] = ["apple", "google_health", "health_connect", "strava", "garmin", "manual"]
  if (!sources.includes(payload.source)) throw new BadRequestError(`source must be one of ${sources.join(", ")}`)

  const { data: profile } = await db.from("profiles").select("timezone").eq("id", userId).single()
  const tz = payload.timezone ?? profile?.timezone ?? "UTC"
  const touched = new Set<string>()

  // Daily metrics: one row per day and source
  const daily = (payload.daily ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
  if (daily.length) {
    const rows = daily.map((d) => {
      touched.add(d.date)
      const n = (v: unknown, digits = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null)
      return {
        user_id: userId, date: d.date, source: payload.source, device: payload.device ?? null,
        steps: n(d.steps), distance_m: n(d.distance_m, 1), active_kcal: n(d.active_kcal, 1), resting_kcal: n(d.resting_kcal, 1),
        resting_hr: n(d.resting_hr), hrv_ms: n(d.hrv_ms, 1), sleep_min: n(d.sleep_min), flights: n(d.flights),
        updated_at: new Date().toISOString(),
      }
    })
    const { error } = await db.from("daily_metrics").upsert(rows, { onConflict: "user_id,date,source" })
    if (error) throw new Error(`daily_metrics: ${error.message}`)
  }

  // Activities
  const acts = payload.activities ?? []
  if (acts.length) {
    const rows = acts.map((a) => {
      const date = (a as { _localDate?: string })._localDate ?? localDateIn(a.start_at, tz)
      touched.add(date)
      const duration = a.duration_s ?? Math.round((Date.parse(a.end_at) - Date.parse(a.start_at)) / 1000)
      return {
        user_id: userId, source: payload.source, external_id: String(a.external_id), type: normaliseActivityType(a.type),
        name: a.name ?? null, date, start_at: a.start_at, end_at: a.end_at, duration_s: Math.max(0, duration),
        distance_m: a.distance_m ?? null, kcal: a.kcal != null ? Math.round(a.kcal * 10) / 10 : null,
        avg_hr: a.avg_hr != null ? Math.round(a.avg_hr) : null, max_hr: a.max_hr != null ? Math.round(a.max_hr) : null,
        steps: a.steps != null ? Math.round(a.steps) : null, elevation_m: a.elevation_m ?? null, device: payload.device ?? null,
        raw: { ...(a.raw ?? {}), kcal_is_net: a.kcal_is_net ?? null, original_type: a.type },
      }
    })
    const { error } = await db.from("activities").upsert(rows, { onConflict: "user_id,source,external_id" })
    if (error) throw new Error(`activities: ${error.message}`)
  }
  const merged = await dedupeDates(userId, [...touched])

  // Weights: replace this source's entry for the day
  let weights = 0
  for (const w of payload.weights ?? []) {
    if (!(w.kg >= 20 && w.kg <= 400)) continue
    touched.add(w.date)
    await db.from("weight_logs").delete().eq("user_id", userId).eq("date", w.date).eq("source", payload.source)
    const { error } = await db.from("weight_logs").insert({
      user_id: userId, date: w.date, kg: Math.round(w.kg * 100) / 100, body_fat_pct: w.body_fat_pct ?? null, source: payload.source,
    })
    if (!error) weights++
  }

  // Refresh the energy cache for every day that changed
  const api = new ServerTiloApi(userId)
  await Promise.all([...touched].slice(-14).map((d) => api.getDay(d).catch(() => null)))

  return { daily: daily.length, activities: acts.length, merged, weights }
}

// Marks duplicates (same session recorded by two sources) and fills the primary's missing fields
export async function dedupeDates(userId: string, dates: string[]): Promise<number> {
  if (!dates.length) return 0
  const db = supabaseAdmin()
  const { data } = await db
    .from("activities")
    .select("id, source, type, start_at, end_at, kcal, avg_hr, max_hr, distance_m, steps, elevation_m, merged_into")
    .eq("user_id", userId)
    .in("date", dates)
  const rows = (data ?? []) as (ActivityLike & { merged_into: string | null })[]
  const { mergedInto, fill } = dedupeActivities(rows)
  let changed = 0
  for (const row of rows) {
    const target = mergedInto.get(row.id) ?? null
    const patch: Record<string, unknown> = {}
    if (row.merged_into !== target) patch.merged_into = target
    Object.assign(patch, fill.get(row.id) ?? {})
    if (Object.keys(patch).length) {
      await db.from("activities").update(patch).eq("id", row.id).eq("user_id", userId)
      if ("merged_into" in patch && target) changed++
    }
  }
  return changed
}
