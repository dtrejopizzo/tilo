// Converts third-party health export formats into Tilo's IngestPayload. Pure functions.
import type { IngestPayload } from "./apiTypes"

function toIso(s: string): string {
  // "2026-10-08 07:10:00 -0300" → ISO
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/)
  return m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : new Date(s).toISOString()
}

// Health Auto Export (iOS app) "REST API" automation, JSON format

interface HaeMetric {
  name: string
  units?: string
  data: { date: string; qty?: number; Avg?: number; source?: string; asleep?: number; totalSleep?: number; inBed?: number }[]
}

interface HaeWorkout {
  id?: string
  name: string
  start: string
  end: string
  duration?: number
  activeEnergyBurned?: { qty: number; units: string }
  activeEnergy?: { qty: number; units: string }
  distance?: { qty: number; units: string }
  avgHeartRate?: { qty: number }
  maxHeartRate?: { qty: number }
  heartRate?: { avg?: { qty: number }; max?: { qty: number } }
  stepCount?: { qty: number }[] | { qty: number }
  elevationUp?: { qty: number; units: string }
}

const kcal = (qty: number, units?: string) => (units && /kj/i.test(units) ? qty / 4.184 : qty)
const meters = (qty: number, units?: string) => (units === "km" ? qty * 1000 : units === "mi" ? qty * 1609.34 : units === "ft" ? qty * 0.3048 : qty)

export function fromHealthAutoExport(body: { data?: { metrics?: HaeMetric[]; workouts?: HaeWorkout[] } }): IngestPayload {
  const days = new Map<string, Record<string, number | string>>()
  const day = (date: string) => {
    const key = date.slice(0, 10)
    if (!days.has(key)) days.set(key, { date: key })
    return days.get(key)!
  }
  const avg = new Map<string, { sum: number; n: number }>()
  const weights: NonNullable<IngestPayload["weights"]> = []
  let device: string | undefined

  for (const metric of body.data?.metrics ?? []) {
    for (const p of metric.data ?? []) {
      const d = day(p.date)
      const q = p.qty ?? p.Avg ?? 0
      if (p.source && !device) device = p.source.split("|")[0]
      switch (metric.name) {
        case "step_count": d.steps = Number(d.steps ?? 0) + q; break
        case "active_energy": d.active_kcal = Number(d.active_kcal ?? 0) + kcal(q, metric.units); break
        case "basal_energy_burned": d.resting_kcal = Number(d.resting_kcal ?? 0) + kcal(q, metric.units); break
        case "walking_running_distance": d.distance_m = Number(d.distance_m ?? 0) + meters(q, metric.units); break
        case "flights_climbed": d.flights = Number(d.flights ?? 0) + q; break
        case "resting_heart_rate":
        case "heart_rate_variability": {
          const k = `${d.date}|${metric.name}`
          const a = avg.get(k) ?? { sum: 0, n: 0 }
          avg.set(k, { sum: a.sum + q, n: a.n + 1 })
          break
        }
        case "sleep_analysis": {
          const hours = p.asleep ?? p.totalSleep ?? q
          d.sleep_min = Number(d.sleep_min ?? 0) + Math.round(hours * 60)
          break
        }
        case "weight_body_mass":
          weights.push({ date: p.date.slice(0, 10), kg: metric.units === "lb" ? q * 0.4536 : q })
          break
        case "body_fat_percentage": {
          const w = weights.find((x) => x.date === p.date.slice(0, 10))
          if (w) w.body_fat_pct = q <= 1 ? q * 100 : q
          break
        }
      }
    }
  }
  for (const [k, a] of avg) {
    const [date, name] = k.split("|")
    days.get(date)![name === "resting_heart_rate" ? "resting_hr" : "hrv_ms"] = Math.round((a.sum / a.n) * 10) / 10
  }

  const activities = (body.data?.workouts ?? []).map((w) => {
    const energy = w.activeEnergyBurned ?? w.activeEnergy
    const steps = Array.isArray(w.stepCount) ? w.stepCount.reduce((s, x) => s + x.qty, 0) : w.stepCount?.qty
    const start = toIso(w.start)
    const end = toIso(w.end)
    return {
      external_id: w.id ?? `${w.name}-${w.start}`,
      type: w.name,
      name: w.name,
      start_at: start,
      end_at: end,
      duration_s: Math.round(w.duration ?? (Date.parse(end) - Date.parse(start)) / 1000),
      distance_m: w.distance ? meters(w.distance.qty, w.distance.units) : undefined,
      kcal: energy ? kcal(energy.qty, energy.units) : undefined,
      kcal_is_net: true,
      avg_hr: w.avgHeartRate?.qty ?? w.heartRate?.avg?.qty,
      max_hr: w.maxHeartRate?.qty ?? w.heartRate?.max?.qty,
      steps,
      elevation_m: w.elevationUp ? meters(w.elevationUp.qty, w.elevationUp.units) : undefined,
      _localDate: w.start.slice(0, 10),
    }
  })

  return { source: "apple", device: device ?? "Apple Health", daily: [...days.values()] as IngestPayload["daily"], activities, weights }
}

