// How the person is doing against the goals they set, from the last two weeks of everything Tilo
// knows: meals, water, weight trend, sleep, steps, sessions, strength volume, resting HR and HRV,
// tasks and habits. Deterministic numbers here; the server adds a short AI reading on top.
import type { RangeData } from "./apiTypes"
import { pickMetrics, type DailyMetricRow } from "./sources"
import { weightTrend } from "./energy"

export interface GoalProgress {
  key: "weight" | "protein" | "water" | "steps" | "sleep" | "training" | "kcal"
  label: string
  value: string // 7-day reading, e.g. "128 g/día"
  target: string // e.g. "objetivo 120 g"
  ratio: number | null // 0..1+ against the goal, for the bar
  trend: "up" | "down" | "flat" | null // vs the previous 7 days
  good: boolean | null // is the trend going the right way
  note?: string
}

export interface ProgressReport {
  days: number
  goals: GoalProgress[]
  facts: Record<string, number | string | null> // compact numbers for the AI reading
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export function buildProgress(r: RangeData, today: string): ProgressReport {
  const g = r.goals
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i))
  const prev7 = Array.from({ length: 7 }, (_, i) => addDays(today, -13 + i))
  // Today is still in progress: averages use the 7 days before it, plus today when it's already counted
  const done7 = Array.from({ length: 7 }, (_, i) => addDays(today, -7 + i))
  const sum = new Map(r.summaries.map((s) => [s.date, s]))
  const metricsByDate = new Map<string, DailyMetricRow[]>()
  for (const m of r.metrics) metricsByDate.set(m.date, [...(metricsByDate.get(m.date) ?? []), m as DailyMetricRow])
  const metric = (d: string) => pickMetrics(metricsByDate.get(d) ?? []).values

  const inLast14 = (d: string) => d > addDays(today, -14) && d <= today
  const series = (days: string[], f: (d: string) => number | null | undefined) => days.map(f).filter((v): v is number => v != null && Number.isFinite(v))
  const trendOf = (a: number | null, b: number | null, tol = 0.05) => (a == null || b == null || b === 0 ? null : a > b * (1 + tol) ? "up" : a < b * (1 - tol) ? "down" : "flat")

  const out: GoalProgress[] = []

  // Protein and calories: only days with meals logged
  const logged = (days: string[]) => days.filter((d) => (sum.get(d)?.meals_count ?? 0) > 0)
  const prot = avg(series(logged(done7), (d) => Number(sum.get(d)?.protein_g)))
  const protPrev = avg(series(logged(prev7), (d) => Number(sum.get(d)?.protein_g)))
  if (g.protein_g) out.push({ key: "protein", label: "Proteína", value: prot != null ? `${Math.round(prot)} g/día` : "sin comidas", target: `objetivo ${g.protein_g} g`, ratio: prot != null ? prot / g.protein_g : null, trend: trendOf(prot, protPrev), good: prot != null && protPrev != null ? prot >= protPrev : null, note: prot != null ? `${logged(done7).length} de 7 días registrados` : undefined })

  const kcal = avg(series(logged(done7), (d) => Number(sum.get(d)?.kcal_in)))
  const burned = avg(series(done7, (d) => Number(r.energy.find((e) => e.date === d)?.total ?? NaN)))

  const water = avg(series(done7, (d) => sum.get(d)?.water_ml ?? null).filter((v) => v > 0))
  const waterPrev = avg(series(prev7, (d) => sum.get(d)?.water_ml ?? null).filter((v) => v > 0))
  if (g.water_ml) out.push({ key: "water", label: "Agua", value: water != null ? `${(water / 1000).toFixed(1)} L/día` : "sin registros", target: `objetivo ${(g.water_ml / 1000).toFixed(1)} L`, ratio: water != null ? water / g.water_ml : null, trend: trendOf(water, waterPrev), good: water != null && waterPrev != null ? water >= waterPrev : null })

  const steps = avg(series(done7, (d) => metric(d).steps))
  const stepsPrev = avg(series(prev7, (d) => metric(d).steps))
  if (g.steps) out.push({ key: "steps", label: "Pasos", value: steps != null ? `${Math.round(steps).toLocaleString("es-AR")}/día` : "sin datos", target: `objetivo ${g.steps.toLocaleString("es-AR")}`, ratio: steps != null ? steps / g.steps : null, trend: trendOf(steps, stepsPrev), good: steps != null && stepsPrev != null ? steps >= stepsPrev : null })

  const sleep = avg(series(last7, (d) => metric(d).sleep_min))
  const sleepPrev = avg(series(prev7, (d) => metric(d).sleep_min))
  if (g.sleep_min) out.push({ key: "sleep", label: "Sueño", value: sleep != null ? `${Math.floor(sleep / 60)} h ${Math.round(sleep % 60)} min` : "sin datos", target: `objetivo ${Math.floor(g.sleep_min / 60)} h ${g.sleep_min % 60 || ""}`.trim(), ratio: sleep != null ? sleep / g.sleep_min : null, trend: trendOf(sleep, sleepPrev, 0.03), good: sleep != null && sleepPrev != null ? sleep >= sleepPrev : null })

  // Training: sessions and minutes this week, and strength sets against the weekly target
  const inWeek = (d: string) => d > addDays(today, -7) && d <= today
  const inPrev = (d: string) => d > addDays(today, -14) && d <= addDays(today, -7)
  const sessions = r.activities.filter((a) => inWeek(a.date))
  const sessionsPrev = r.activities.filter((a) => inPrev(a.date)).length
  const minutes = Math.round(sessions.reduce((s, a) => s + a.duration_s, 0) / 60)
  const sets = r.muscle_sets.filter((m) => inWeek(m.date)).reduce((s, m) => s + m.sets, 0)
  const byType = new Map<string, number>()
  for (const a of sessions) byType.set(a.type, (byType.get(a.type) ?? 0) + 1)
  out.push({
    key: "training", label: "Entrenamiento", value: `${sessions.length} sesiones · ${minutes} min`,
    target: g.weekly_sets_target ? `${sets}/${g.weekly_sets_target} series de fuerza` : `${sets} series de fuerza`,
    ratio: g.weekly_sets_target ? sets / g.weekly_sets_target : null, trend: trendOf(sessions.length, sessionsPrev, 0.01), good: sessions.length >= sessionsPrev,
    note: [...byType].map(([t, n]) => `${n} ${t}`).join(" · ") || undefined,
  })

  // Weight: smoothed trend, weekly change and the date the target would be reached at this pace
  const trend = weightTrend(r.weights.map((w) => ({ date: w.date, kg: Number(w.kg) })), r.from, today)
  const nowKg = trend.get(today) ?? null
  const weekAgo = trend.get(addDays(today, -7)) ?? null
  const perWeek = nowKg != null && weekAgo != null ? nowKg - weekAgo : null
  if (nowKg != null) {
    const target = g.weight_target_kg != null ? Number(g.weight_target_kg) : null
    const towards = target != null && perWeek != null ? Math.sign(target - nowKg) === Math.sign(perWeek) && Math.abs(perWeek) > 0.02 : null
    const weeks = target != null && perWeek && towards ? Math.abs((target - nowKg) / perWeek) : null
    out.unshift({
      key: "weight", label: "Peso", value: `${nowKg.toFixed(1)} kg${perWeek != null ? ` (${perWeek > 0 ? "+" : ""}${perWeek.toFixed(1)}/sem)` : ""}`,
      target: target != null ? `objetivo ${target} kg` : "sin objetivo",
      ratio: null, trend: perWeek == null ? null : perWeek > 0.05 ? "up" : perWeek < -0.05 ? "down" : "flat", good: towards,
      note: weeks != null ? `a este ritmo llegás en ~${Math.round(weeks)} semanas` : target != null && towards === false ? "va en dirección contraria al objetivo" : undefined,
    })
  }

  const hr = avg(series(done7, (d) => metric(d).resting_hr))
  const hrPrev = avg(series(prev7, (d) => metric(d).resting_hr))
  const hrv = avg(series(done7, (d) => metric(d).hrv_ms))
  const irregular = r.metrics.filter((m) => inLast14(m.date)).reduce((s, m) => s + Number((m as { irregular_rhythm_events?: number | null }).irregular_rhythm_events ?? 0), 0)
  const tasks = avg(series(done7, (d) => sum.get(d)?.tasks_done ?? 0))
  const habitRate = (() => {
    const daily = r.habits.filter((h) => h.frequency === "daily")
    if (!daily.length) return null
    const done = daily.reduce((s, h) => s + h.dates.filter((d) => done7.includes(d)).length, 0)
    return done / (daily.length * 7)
  })()

  return {
    days: 14,
    goals: out,
    facts: {
      kcal_in_avg: kcal != null ? Math.round(kcal) : null, kcal_goal: g.kcal, kcal_burned_avg: burned != null ? Math.round(burned) : null,
      balance_avg: kcal != null && burned != null ? Math.round(kcal - burned) : null, meal_days_logged: logged(done7).length,
      protein_avg: prot != null ? Math.round(prot) : null, protein_goal: g.protein_g,
      water_avg_ml: water != null ? Math.round(water) : null, water_goal_ml: g.water_ml,
      steps_avg: steps != null ? Math.round(steps) : null, steps_goal: g.steps,
      sleep_avg_min: sleep != null ? Math.round(sleep) : null, sleep_goal_min: g.sleep_min,
      resting_hr_avg: hr != null ? Math.round(hr) : null, resting_hr_prev: hrPrev != null ? Math.round(hrPrev) : null, hrv_avg_ms: hrv != null ? Math.round(hrv) : null, irregular_rhythm_notifications_14d: irregular,
      sessions_week: sessions.length, sessions_prev_week: sessionsPrev, sport_minutes_week: minutes, strength_sets_week: sets, sets_goal: g.weekly_sets_target,
      session_types: [...byType].map(([t, n]) => `${t}:${n}`).join(","),
      weight_kg: nowKg != null ? Math.round(nowKg * 10) / 10 : null, weight_change_week: perWeek != null ? Math.round(perWeek * 100) / 100 : null, weight_goal: g.weight_target_kg, weight_goal_date: g.weight_target_date,
      tasks_done_avg: tasks != null ? Math.round(tasks * 10) / 10 : null, daily_habit_rate: habitRate != null ? Math.round(habitRate * 100) : null,
    },
  }
}
