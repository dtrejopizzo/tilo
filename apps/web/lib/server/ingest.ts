// Device data from any source → daily_metrics, activities (deduplicated across sources) and weight_logs.
// Accepts Tilo's own format (iOS Shortcut, Android companion, Strava sync) and the JSON that the
// "Health Auto Export" iOS app posts, so iPhone users can sync with zero setup beyond pasting a URL.
import type { IngestPayload, IngestResult, MetricSource } from "@tilo/core/apiTypes"
import { dedupeActivities, inferHabitActivityTypes, inferHabitMinMinutes, normaliseActivityType, type ActivityLike } from "@tilo/core/sources"
export { fromHealthAutoExport } from "@tilo/core/ingestFormats"
import { supabaseAdmin } from "../supabase/server"
import { BadRequestError, PaymentRequiredError } from "./apiRoute"
import { classifyHabit } from "./ai"
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
    // Only the fields this sync measured: a missing value must never erase one stored before
    const { data: before } = await db.from("daily_metrics").select("*").eq("user_id", userId).eq("source", payload.source).in("date", daily.map((d) => d.date))
    const prev = new Map((before ?? []).map((r) => [r.date as string, r as Record<string, unknown>]))
    const rows = daily.map((d) => {
      touched.add(d.date)
      const n = (v: unknown, digits = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null)
      return {
        user_id: userId, date: d.date, source: payload.source, device: payload.device ?? null,
        steps: n(d.steps), distance_m: n(d.distance_m, 1), active_kcal: n(d.active_kcal, 1), resting_kcal: n(d.resting_kcal, 1),
        resting_hr: n(d.resting_hr), hrv_ms: n(d.hrv_ms, 1), sleep_min: n(d.sleep_min), flights: n(d.flights),
        ...(d.irregular_rhythm_events != null ? { irregular_rhythm_events: n(d.irregular_rhythm_events) } : {}),
        updated_at: new Date().toISOString(),
      }
    }).map((r) => {
      const old = prev.get(r.date)
      if (!old) return r
      const merged: Record<string, unknown> = { ...r }
      for (const [k, v] of Object.entries(r)) if (v == null && old[k] != null) merged[k] = old[k]
      return merged as typeof r
    })
    let { error } = await db.from("daily_metrics").upsert(rows, { onConflict: "user_id,date,source" })
    // A column added by a newer migration that isn't applied yet: keep the rest of the data
    if (error && /irregular_rhythm_events/.test(error.message)) {
      ;({ error } = await db.from("daily_metrics").upsert(rows.map(({ irregular_rhythm_events: _, ...r }) => r), { onConflict: "user_id,date,source" }))
    }
    if (error) throw new Error(`daily_metrics: ${error.message}`)
  }

  // Sessions the phone detected from raw samples ("inferred-…"): each sync sends the current list
  // for its days, so drop the previous ones first
  const inferredDates = (payload as { inferred_dates?: string[] }).inferred_dates ?? []
  if (inferredDates.length) {
    await db.from("activities").delete().eq("user_id", userId).eq("source", payload.source).like("external_id", "inferred-%").in("date", inferredDates)
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
  await dropInferredCoveredByReal(userId, [...touched])
  const merged = await dedupeDates(userId, [...touched])
  await autoCompleteHabits(userId, [...touched]).catch((e) => console.error("[habits] auto:", e))

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

// Session types a habit can be completed by (normalised, see packages/core/src/sources.ts)
const SESSION_TYPES = ["run", "walk", "hike", "ride", "swim", "strength", "hiit", "other", "yoga", "mobility", "tennis", "padel", "football", "golf", "rowing", "climbing", "boxing", "martial_arts", "dance", "surf", "ski", "elliptical", "basketball", "volleyball", "rugby", "hockey", "skate"]

type HabitRule = { activity_types?: string[]; min_minutes?: number; inferred?: boolean } | null

// Habits are completed by the day's sessions from any source: "Correr" by a run from Strava,
// Apple Health or Google Health, "Entrenar" by a gym session, "Golf" by golf. Habits without a rule
// get one inferred from their name (keywords, then the cheap AI model once) and stored in auto_rule,
// which also lets the database trigger complete them as new sessions arrive.
export async function autoCompleteHabits(userId: string, dates: string[]): Promise<number> {
  if (!dates.length) return 0
  const db = supabaseAdmin()
  const { data: habits } = await db.from("habits").select("id, name, auto_rule").eq("user_id", userId).eq("archived", false)
  const rules = new Map<string, { types: string[]; min: number }>()
  for (const h of (habits ?? []) as { id: string; name: string; auto_rule: HabitRule }[]) {
    let rule = h.auto_rule
    if (!rule) {
      let types = inferHabitActivityTypes(h.name)
      if (!types) {
        try {
          types = await classifyHabit(userId, h.name, SESSION_TYPES)
        } catch (e) {
          if (!(e instanceof PaymentRequiredError)) console.error("[habits] classify:", e)
          continue // try again next sync
        }
      }
      rule = { activity_types: types, min_minutes: inferHabitMinMinutes(h.name), inferred: true }
      await db.from("habits").update({ auto_rule: rule }).eq("id", h.id).eq("user_id", userId)
    }
    if (rule.activity_types?.length) rules.set(h.id, { types: rule.activity_types, min: rule.min_minutes ?? 0 })
  }
  if (!rules.size) return 0
  const { data: acts } = await db
    .from("activities")
    .select("date, type, duration_s")
    .eq("user_id", userId)
    .in("date", dates)
    .is("merged_into", null)
  const logs: { habit_id: string; user_id: string; date: string; source: "auto" }[] = []
  for (const a of (acts ?? []) as { date: string; type: string; duration_s: number }[]) {
    for (const [habitId, r] of rules) {
      if (r.types.includes(a.type) && a.duration_s >= r.min * 60) logs.push({ habit_id: habitId, user_id: userId, date: a.date, source: "auto" })
    }
  }
  if (!logs.length) return 0
  const unique = [...new Map(logs.map((l) => [`${l.habit_id}:${l.date}`, l])).values()]
  const { error } = await db.from("habit_logs").upsert(unique, { onConflict: "habit_id,date", ignoreDuplicates: true })
  if (error) throw new Error(`habit_logs: ${error.message}`)
  return unique.length
}

// A detected session gives way to the real workout (from any source) that covers the same time
async function dropInferredCoveredByReal(userId: string, dates: string[]) {
  if (!dates.length) return
  const db = supabaseAdmin()
  const { data } = await db.from("activities").select("id, external_id, start_at, end_at").eq("user_id", userId).in("date", dates)
  const rows = (data ?? []) as { id: string; external_id: string; start_at: string; end_at: string }[]
  const real = rows.filter((r) => !r.external_id.startsWith("inferred-"))
  const covered = rows
    .filter((r) => r.external_id.startsWith("inferred-"))
    .filter((r) => real.some((x) => Date.parse(x.start_at) < Date.parse(r.end_at) && Date.parse(r.start_at) < Date.parse(x.end_at)))
    .map((r) => r.id)
  if (covered.length) await db.from("activities").delete().in("id", covered).eq("user_id", userId)
}
