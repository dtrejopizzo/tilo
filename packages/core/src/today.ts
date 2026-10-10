// Derives everything the Today screen (web), the VSCode sidebar and MCP get_today show
// from one get_day() response.
import type { Activity, DayData, Habit, Supplement, SupplementSlot, Task } from "./apiTypes"
import { ageFrom, computeDayEnergy, weightTrend, type DayEnergy, type ExerciseSession } from "./energy"
import { pickMetrics, type DailyMetricRow, type MetricKey, type Source } from "./sources"
import { electrolyteSuggestion, SLOT_LABELS } from "./supplements"
import { suggestNext } from "./training"

export interface ChecklistItem {
  kind: "habit" | "supplement"
  id: string
  name: string
  detail: string
  done: boolean
  auto: boolean
  lowStock: boolean
}

export interface ChecklistGroup {
  slot: SupplementSlot
  label: string
  items: ChecklistItem[]
}

export interface TodayView {
  date: string
  name: string
  tasks: { dueOrOverdue: Task[]; upcoming: Task[]; someday: Task[]; doneToday: Task[] }
  checklist: ChecklistGroup[]
  checklistDone: number
  checklistTotal: number
  water: { total: number; target: number }
  nutrition: {
    kcal: number; protein: number; carbs: number; fat: number; fiber: number
    targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number }
  }
  caffeine: { mg: number; max: number; cutoff: string }
  metrics: { values: Partial<Record<MetricKey, number>>; sources: Partial<Record<MetricKey, Source>> }
  stepsTarget: number
  energy: DayEnergy
  weight: { latest: number | null; trend: number | null }
  training: {
    routineName: string | null
    items: { id: string; exerciseId: string; name: string; target: string; last: string | null; suggestion: string | null; suggestedKg: number | null }[]
    workouts: DayData["workouts"]
    activities: Activity[]
    electrolytes: ReturnType<typeof electrolyteSuggestion>
  }
  email: {
    unread: number | null
    inboxTotal: number | null
    personal: number | null
    newsletters: number | null
    trend: { date: string; inbox: number }[]
    insights: DayData["email"]["insights"]
  }
  checkin: { energy: number | null; mood: number | null }
  focusMin: number
}

const SLOT_ORDER: SupplementSlot[] = ["wake", "breakfast", "pre_workout", "lunch", "with_meal", "post_workout", "dinner", "any", "bed"]
const LOWER_BODY = new Set(["quads", "hamstrings", "glutes", "calves"])

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

function habitSlot(h: Habit): SupplementSlot {
  if (!h.reminder_time) return "any"
  const hour = Number(h.reminder_time.slice(0, 2))
  return hour < 8 ? "wake" : hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 20 ? "any" : hour < 22 ? "dinner" : "bed"
}

function doseLabel(s: Supplement): string {
  const unit = s.unit === "iu" ? "UI" : s.unit === "caps" ? (s.dose === 1 ? "cápsula" : "cápsulas") : s.unit === "scoop" ? (s.dose === 1 ? "scoop" : "scoops") : s.unit
  return `${s.dose % 1 === 0 ? s.dose : s.dose.toFixed(1)} ${unit}`
}

export function buildChecklist(habits: Habit[], supplements: Supplement[]): ChecklistGroup[] {
  const groups = new Map<SupplementSlot, ChecklistItem[]>()
  const push = (slot: SupplementSlot, item: ChecklistItem) => groups.set(slot, [...(groups.get(slot) ?? []), item])
  for (const h of habits) {
    push(habitSlot(h), {
      kind: "habit", id: h.id, name: h.name, done: h.done, auto: h.auto, lowStock: false,
      detail: h.frequency === "weekly" ? `${h.week_count}/${h.per_week} esta semana` : h.auto_rule ? "auto" : "hábito",
    })
  }
  for (const s of supplements) {
    push(s.slot, {
      kind: "supplement", id: s.id, name: s.name, done: s.taken, auto: false,
      lowStock: s.stock_doses != null && s.stock_doses <= 7,
      detail: doseLabel(s) + (s.stock_doses != null && s.stock_doses <= 7 ? ` · quedan ${s.stock_doses}` : ""),
    })
  }
  return SLOT_ORDER.filter((slot) => groups.has(slot)).map((slot) => ({ slot, label: SLOT_LABELS[slot], items: groups.get(slot)! }))
}

export function bucketTasks(tasks: Task[], date: string, upcomingDays = 14) {
  const horizon = addDays(date, upcomingDays)
  const todo = tasks.filter((t) => t.status === "todo")
  return {
    dueOrOverdue: todo.filter((t) => t.due_date && t.due_date <= date),
    upcoming: todo.filter((t) => t.due_date && t.due_date > date && t.due_date <= horizon),
    someday: todo.filter((t) => !t.due_date || t.due_date > horizon),
    doneToday: tasks.filter((t) => t.status === "done" && t.completed_on === date),
  }
}

function setsLabel(sets: { weight_kg: number | null; reps: number | null }[] | null): string | null {
  if (!sets?.length) return null
  const weights = [...new Set(sets.map((s) => Number(s.weight_kg ?? 0)))]
  const reps = sets.map((s) => s.reps ?? 0).join(", ")
  return weights.length === 1 ? `${weights[0] || "BW"} × ${reps}` : sets.map((s) => `${Number(s.weight_kg ?? 0) || "BW"}×${s.reps}`).join(", ")
}

export function buildToday(day: DayData, opts: { priority?: Source[]; pinned?: Partial<Record<MetricKey, Source>> } = {}): TodayView {
  const g = day.goals
  const sum = <K extends "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g" | "alcohol_g" | "caffeine_mg">(k: K) =>
    day.meals.reduce((s, m) => s + Number(m[k] ?? 0), 0)
  const suppNutrient = (key: string) =>
    day.supplements.filter((s) => s.taken).reduce((acc, s) => acc + Number(s.nutrients?.[key] ?? 0), 0)

  const kcal = sum("kcal") + suppNutrient("kcal")
  const protein = sum("protein_g") + suppNutrient("protein_g")
  const carbs = sum("carbs_g") + suppNutrient("carbs_g")
  const fat = sum("fat_g") + suppNutrient("fat_g")

  // Best source per metric
  const metrics = pickMetrics(day.metrics as DailyMetricRow[], opts.priority, opts.pinned)
  const activeSource = metrics.sources.active_kcal
  const activeRow = day.metrics.find((m) => m.source === activeSource)
  const watchMeasured = activeRow != null && /watch|band|fitbit|pixel/i.test(activeRow.device ?? "")

  // Weight trend for BMR
  const trend = weightTrend(day.weights_recent.map((w) => ({ date: w.date, kg: Number(w.kg) })), addDays(day.date, -28), day.date)
  const weightKg = trend.get(day.date) ?? (day.weight ? Number(day.weight.kg) : 75)

  // Exercise sessions: device activities plus gym sessions with no watch recording
  const sessions: ExerciseSession[] = [
    ...day.activities.map((a) => ({
      id: a.id, type: a.type, durationS: a.duration_s, kcal: a.kcal, kcalIsNet: a.source === "apple" || a.source === "health_connect" || a.source === "google_health",
      avgHr: a.avg_hr, steps: a.steps, distanceM: a.distance_m,
      coveredByActiveEnergy: activeSource != null && a.source === activeSource,
    })),
    ...day.workouts
      .filter((w) => !w.activity_id && w.ended_at)
      .map((w) => {
        const rpes = w.sets.filter((s) => s.rpe != null).map((s) => Number(s.rpe))
        return {
          id: w.id, type: "strength", durationS: (Date.parse(w.ended_at!) - Date.parse(w.started_at)) / 1000,
          avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
          coveredByActiveEnergy: watchMeasured,
        }
      }),
  ]

  const energy = computeDayEnergy(
    {
      sex: day.profile.sex,
      ageYears: ageFrom(day.profile.birth_date, day.date),
      heightCm: day.profile.height_cm != null ? Number(day.profile.height_cm) : null,
      bodyFatPct: day.weight?.body_fat_pct != null ? Number(day.weight.body_fat_pct) : day.profile.body_fat_pct != null ? Number(day.profile.body_fat_pct) : null,
      activityLevel: Number(day.profile.activity_level),
    },
    {
      date: day.date,
      weightKg,
      steps: metrics.values.steps ?? null,
      activeKcal: metrics.values.active_kcal ?? null,
      sessions,
      intake: day.meals.length || kcal ? { kcal, proteinG: protein, carbsG: carbs, fatG: fat, alcoholG: sum("alcohol_g") } : null,
      calibration: day.energy?.calibration != null ? Number(day.energy.calibration) : Number((day.settings as { calibration?: number } | null)?.calibration ?? 1),
    },
  )

  const checklist = buildChecklist(day.habits, day.supplements)
  const items = checklist.flatMap((g) => g.items)

  const longest = day.activities.reduce<Activity | null>((a, b) => (!a || b.duration_s > a.duration_s ? b : a), null)
  const snapshots = [...day.email.snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const latestDate = snapshots.at(-1)?.date
  const latest = snapshots.filter((s) => s.date === latestDate)
  const trendByDate = new Map<string, number>()
  for (const s of snapshots) trendByDate.set(s.date, (trendByDate.get(s.date) ?? 0) + s.inbox_total)
  const total = (k: "unread" | "inbox_total" | "personal" | "newsletters") => (latest.length ? latest.reduce((a, s) => a + s[k], 0) : null)
  const lastCheckin = day.checkins.at(-1)

  return {
    date: day.date,
    name: day.profile.name?.split(" ")[0] ?? "",
    tasks: bucketTasks(day.tasks, day.date, Number((day.settings as { upcoming_days?: number } | null)?.upcoming_days ?? 14)),
    checklist,
    checklistDone: items.filter((i) => i.done).length,
    checklistTotal: items.length,
    water: { total: day.water.reduce((s, w) => s + w.ml, 0), target: g.water_ml },
    nutrition: {
      kcal: Math.round(kcal), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat), fiber: Math.round(sum("fiber_g")),
      targets: { kcal: g.kcal, protein: g.protein_g, carbs: g.carbs_g, fat: g.fat_g, fiber: g.fiber_g },
    },
    caffeine: { mg: Math.round(sum("caffeine_mg") + day.caffeine.reduce((s, c) => s + c.mg, 0) + suppNutrient("caffeine_mg")), max: g.caffeine_max_mg, cutoff: g.caffeine_cutoff },
    metrics,
    stepsTarget: g.steps,
    energy,
    weight: { latest: day.weight ? Number(day.weight.kg) : null, trend: trend.get(day.date) ?? null },
    training: {
      routineName: day.routine?.name ?? null,
      items: (day.routine?.items ?? []).map((i) => {
        const last = i.last?.map((s) => ({ weightKg: Number(s.weight_kg ?? 0), reps: s.reps ?? 0, rpe: s.rpe })) ?? []
        const next = i.exercise.kind === "strength" && i.reps_max
          ? suggestNext(last, { sets: i.sets, repsMin: i.reps_min ?? i.reps_max, repsMax: i.reps_max, lowerBody: LOWER_BODY.has(i.exercise.primary_muscle) })
          : null
        return {
          id: i.id, exerciseId: i.exercise_id, name: i.exercise.name,
          target: `${i.sets} × ${i.reps_min && i.reps_max && i.reps_min !== i.reps_max ? `${i.reps_min}-${i.reps_max}` : i.reps_max ?? i.reps_min ?? "AMRAP"}`,
          last: setsLabel(i.last), suggestion: next?.note ?? null, suggestedKg: next?.weightKg ?? null,
        }
      }),
      workouts: day.workouts,
      activities: day.activities,
      electrolytes: longest ? electrolyteSuggestion(Math.round(longest.duration_s / 60), longest.avg_hr) : null,
    },
    email: {
      unread: total("unread"), inboxTotal: total("inbox_total"), personal: total("personal"), newsletters: total("newsletters"),
      trend: [...trendByDate.entries()].map(([date, inbox]) => ({ date, inbox })),
      insights: day.email.insights,
    },
    checkin: { energy: lastCheckin?.energy ?? null, mood: lastCheckin?.mood ?? null },
    focusMin: day.focus_min,
  }
}
