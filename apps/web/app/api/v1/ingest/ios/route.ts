import type { IngestPayload } from "@tilo/core/apiTypes"
import { apiRoute, readJson } from "@/lib/server/apiRoute"
import { ingest } from "@/lib/server/ingest"

export const runtime = "nodejs"
export const maxDuration = 60

// POST from the iOS Shortcut (see integrations/README.md → "Apple Health con un Atajo").
// Shaped for what Shortcuts can build easily, in any locale:
// { date?: "2026-10-16", steps, distance_km, active_kcal, resting_hr, hrv_ms, sleep_h, weight_kg,
//   workouts: "Running;2026-10-16T19:43:00-03:00;3616;520;10.2\n…" }   (type;start;seconds;kcal;km per line)
// Numbers may come as "8,5" or "8.5" or "1.234,5"; empty or missing values are skipped.
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v !== "string") return undefined
  let t = v.trim().replace(/[^\d.,-]/g, "")
  if (!t) return undefined
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "")
  else if (t.includes(",")) t = t.replace(",", ".")
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export const POST = apiRoute(async ({ uid, req }) => {
  const b = await readJson(req)
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(b.date) ? b.date.slice(0, 10) : undefined
  const tz = typeof b.timezone === "string" ? b.timezone : undefined
  const today = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "America/Argentina/Buenos_Aires" }).format(new Date())

  const daily: NonNullable<IngestPayload["daily"]>[number] = { date: today }
  const steps = num(b.steps), km = num(b.distance_km), kcal = num(b.active_kcal), hr = num(b.resting_hr), hrv = num(b.hrv_ms), sleep = num(b.sleep_h)
  // Steps are whole: "8.432" and "8,432" are thousands separators, not decimals
  const stepsInt = typeof b.steps === "string" ? Number(b.steps.replace(/\D/g, "")) || undefined : steps
  if (stepsInt != null) daily.steps = Math.round(stepsInt)
  if (km != null) daily.distance_m = km * 1000
  if (kcal != null) daily.active_kcal = kcal
  if (hr != null && hr > 0) daily.resting_hr = hr
  if (hrv != null && hrv > 0) daily.hrv_ms = hrv
  if (sleep != null && sleep > 0) daily.sleep_min = Math.round(sleep * 60)

  const activities: NonNullable<IngestPayload["activities"]> = []
  const lines = Array.isArray(b.workouts) ? b.workouts.map(String) : String(b.workouts ?? "").split(/\r?\n/)
  for (const line of lines) {
    const [type, start, secs, wkcal, wkm] = line.split(";").map((x) => x.trim())
    const startMs = Date.parse(start ?? "")
    const dur = num(secs)
    if (!type || Number.isNaN(startMs) || !dur) continue
    activities.push({
      external_id: `ios-${startMs}`,
      type,
      name: type,
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(startMs + dur * 1000).toISOString(),
      duration_s: Math.round(dur),
      kcal: num(wkcal),
      kcal_is_net: true, // Apple's workout energy is active energy
      distance_m: num(wkm) != null ? num(wkm)! * 1000 : undefined,
    })
  }

  const weight = num(b.weight_kg)
  const r = await ingest(uid, {
    source: "apple",
    device: typeof b.device === "string" ? b.device : "Apple Watch",
    timezone: tz,
    daily: Object.keys(daily).length > 1 ? [daily] : [],
    activities,
    weights: weight != null && weight > 20 ? [{ date: today, kg: weight }] : [],
  })
  return { ok: true, date: today, ...r }
})
