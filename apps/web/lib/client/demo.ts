"use client"

// Demo mode (NEXT_PUBLIC_DEMO=true): a fake Tilo backend that lives in the browser, so the app can be
// tried without Supabase or Google. It answers the same /api/v1 requests as the real server and
// builds days the same way get_day / get_range do. Data is kept in localStorage.
import type {
  Activity, DailyMetric, DayData, EmailInsight, EmailSnapshot, Goals, Habit, Meal, Profile, Project, RangeData,
  Routine, Supplement, Task, Workout, WorkoutSet,
} from "@tilo/core/apiTypes"
import { localDate, TiloClient } from "@tilo/core/client"
import { EXERCISES, findExercise } from "@tilo/core/exercises"
import { parseQuickAdd } from "@tilo/core/quickAdd"
import { SUPPLEMENT_PRESETS } from "@tilo/core/supplements"
import { buildToday } from "@tilo/core/today"
import { bestSet, e1rm } from "@tilo/core/training"

const KEY = "tilo-demo-v1"

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
const dow = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 // 0 = Monday
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

interface Store {
  profile: Profile
  goals: Goals
  settings: Record<string, unknown>
  projects: Project[]
  tasks: Task[]
  habits: (Omit<Habit, "done" | "auto" | "week_count"> & { archived?: boolean })[]
  habitLogs: { habit_id: string; date: string; source: string }[]
  supplements: (Omit<Supplement, "taken"> & { archived?: boolean })[]
  suppLogs: { supplement_id: string; date: string }[]
  meals: Meal[]
  water: { id: string; date: string; ml: number; logged_at: string }[]
  caffeine: { id: string; date: string; mg: number; label: string | null; logged_at: string }[]
  weights: { id: string; date: string; kg: number; body_fat_pct: number | null }[]
  routines: (Omit<Routine, "items"> & { archived?: boolean })[]
  routineItems: { id: string; routine_id: string; exercise_id: string; position: number; sets: number; reps_min: number | null; reps_max: number | null; rpe: number | null; rest_sec: number; superset_group: number | null; notes: string | null }[]
  workouts: Omit<Workout, "sets">[]
  sets: Omit<WorkoutSet, "exercise_name">[]
  activities: Activity[]
  metrics: DailyMetric[]
  snapshots: EmailSnapshot[]
  insights: (EmailInsight & { dismissed?: boolean; task_id?: string | null })[]
  focus: { id: string; date: string; started_at: string; ended_at: string | null; kind: string; task_id: string | null }[]
  checkins: { id: string; date: string; at: string; energy: number | null; mood: number | null; note: string | null }[]
  tokens: { id: string; name: string; preview: string; kind: "personal" | "mcp_oauth" | "ingest"; createdAt: string; lastUsedAt: string | null }[]
}

const exerciseId = (slug: string) => `ex-${slug}`
const exerciseName = (id: string) => {
  const e = EXERCISES.find((x) => exerciseId(x.slug) === id)
  return e?.name_es ?? id.replace(/^ex-/, "")
}

// ---------- seed ----------

function seed(): Store {
  let r = 42
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
  const today = localDate()
  const start = addDays(today, -120)
  const s: Store = {
    profile: {
      id: "demo", email: "demo@tilo.app", name: "David Demo", avatar_url: null, birth_date: "1992-05-14", sex: "male",
      height_cm: 178, body_fat_pct: 15, activity_level: 1.375, timezone: "America/Argentina/Buenos_Aires",
      onboarding_done: true, plan: "trial", trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    },
    goals: {
      kcal: 2350, protein_g: 165, carbs_g: 240, fat_g: 75, fiber_g: 30, water_ml: 3000, steps: 10000, sleep_min: 450,
      weight_target_kg: 76, weight_target_date: addDays(today, 120), caffeine_max_mg: 400, caffeine_cutoff: "15:00", weekly_sets_target: 10,
    },
    settings: { streak_freezes: 1 },
    projects: [
      { id: "p-personal", name: "Personal", color: "#2f9e5f", position: 0 },
      { id: "p-work", name: "Work", color: "#2f7fe0", position: 1 },
      { id: "p-tilo", name: "Tilo", color: "#8a5cd6", position: 2 },
    ],
    tasks: [], habits: [], habitLogs: [], supplements: [], suppLogs: [], meals: [], water: [], caffeine: [], weights: [],
    routines: [], routineItems: [], workouts: [], sets: [], activities: [], metrics: [], snapshots: [], insights: [], focus: [], checkins: [],
    tokens: [{ id: "tok1", name: "VSCode MacBook", preview: "tilo_x7Hk…9fQ2", kind: "personal", createdAt: addDays(today, -20), lastUsedAt: today }],
  }

  s.habits = [
    { id: "h-med", name: "Meditar 10 min", frequency: "daily", per_week: 7, reminder_time: "07:00", auto_rule: null, position: 0 },
    { id: "h-read", name: "Leer 20 páginas", frequency: "daily", per_week: 7, reminder_time: "22:30", auto_rule: null, position: 1 },
    { id: "h-sugar", name: "Sin azúcar", frequency: "daily", per_week: 7, reminder_time: null, auto_rule: null, position: 2 },
    { id: "h-run", name: "Correr", frequency: "weekly", per_week: 3, reminder_time: null, auto_rule: { activity_types: ["run"], min_minutes: 15 }, position: 3 },
    { id: "h-eng", name: "Inglés 30 min", frequency: "weekly", per_week: 3, reminder_time: "19:00", auto_rule: null, position: 4 },
  ]
  const preset = (key: string) => SUPPLEMENT_PRESETS.find((p) => p.key === key)!
  s.supplements = [
    ["vitamin_d3", [0, 1, 2, 3, 4, 5, 6], 54], ["creatine", [0, 1, 2, 3, 4, 5, 6], 80], ["omega3", [0, 1, 2, 3, 4, 5, 6], 6],
    ["magnesium", [0, 1, 2, 3, 4, 5, 6], 40], ["electrolytes", [0, 2, 4], 18], ["whey", [0, 1, 2, 3, 4, 5], 22],
  ].map(([key, days, stock], i) => {
    const p = preset(key as string)
    return { id: `s-${key}`, name: p.name, dose: p.dose, unit: p.unit, slot: p.slot, days: days as number[], with_food: p.withFood, stock_doses: stock as number, nutrients: p.nutrients, position: i }
  })

  const routines: [string, string, number[], [string, number, number, number, number, number][]][] = [
    ["r-push", "Push A", [0, 3], [["bench-press", 4, 6, 8, 150, 75], ["overhead-press", 3, 8, 10, 120, 45], ["incline-dumbbell-press", 3, 10, 12, 90, 28], ["dips", 3, 8, 12, 90, 0], ["triceps-pushdown", 3, 12, 15, 60, 22.5]]],
    ["r-pull", "Pull A", [1, 4], [["deadlift", 3, 4, 6, 180, 130], ["pull-up", 4, 6, 10, 120, 0], ["barbell-row", 3, 8, 10, 120, 70], ["face-pull", 3, 12, 15, 60, 20], ["hammer-curl", 3, 10, 12, 60, 16]]],
    ["r-legs", "Legs", [2, 5], [["back-squat", 4, 5, 8, 180, 110], ["romanian-deadlift", 3, 8, 10, 120, 90], ["leg-press", 3, 10, 12, 90, 180], ["lying-leg-curl", 3, 10, 12, 60, 45], ["standing-calf-raise", 4, 12, 15, 60, 80]]],
  ]
  const baseWeight = new Map<string, number>()
  for (const [id, name, weekdays, items] of routines) {
    s.routines.push({ id, name, weekdays, notes: null })
    items.forEach(([slug, sets, min, max, rest, w], i) => {
      s.routineItems.push({ id: `${id}-${i}`, routine_id: id, exercise_id: exerciseId(slug), position: i, sets, reps_min: min, reps_max: max, rpe: null, rest_sec: rest, superset_group: null, notes: null })
      baseWeight.set(slug, w)
    })
  }

  const mealsPool: [string, string, number, number, number, number, number][] = [
    ["breakfast", "3 huevos revueltos, tostada integral y palta", 520, 28, 32, 30, 7],
    ["breakfast", "Yogur griego con granola y banana", 430, 26, 58, 10, 5],
    ["breakfast", "Avena con whey y frutos rojos", 480, 36, 62, 10, 9],
    ["lunch", "Pollo grillado 200 g, arroz 150 g y ensalada", 690, 52, 68, 18, 4],
    ["lunch", "Milanesa de carne al horno con puré", 780, 48, 62, 34, 4],
    ["lunch", "Bowl de quinoa, salmón y verduras", 650, 42, 55, 26, 8],
    ["snack", "Whey 30 g + banana", 230, 25, 28, 2, 3],
    ["snack", "2 medialunas y un cortado", 340, 7, 42, 16, 1],
    ["dinner", "Bife de chorizo 250 g con ensalada", 720, 62, 8, 46, 3],
    ["dinner", "Fideos con salsa bolognesa", 760, 38, 98, 22, 6],
    ["dinner", "Wok de pollo y vegetales con arroz", 640, 44, 70, 16, 6],
  ]

  let weight = 80.9
  let inbox = 64
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const isToday = d === today
    const wd = dow(d)
    // Habits: a streak running into today, with a frozen miss two weeks ago
    const missDay = Number(today.slice(8)) > 3 ? addDays(today, -3) : addDays(today, -12)
    const streakDay = d >= addDays(today, -16) && d !== missDay
    for (const h of s.habits) {
      if (isToday && h.id !== "h-med") continue
      if (d === missDay && h.id === "h-sugar") continue // a miss the streak freeze saves
      const p = h.frequency === "weekly" ? 0.45 : streakDay ? 1 : 0.78
      if (rnd() < p && h.id !== "h-run") s.habitLogs.push({ habit_id: h.id, date: d, source: "manual" })
    }
    for (const sp of s.supplements) {
      if (!sp.days.includes(wd)) continue
      if (isToday && !["s-vitamin_d3", "s-creatine"].includes(sp.id)) continue
      if (rnd() < 0.88) s.suppLogs.push({ supplement_id: sp.id, date: d })
    }
    // Meals, water, weight
    const meals = isToday ? ["breakfast", "lunch"] : ["breakfast", "lunch", rnd() < 0.6 ? "snack" : "", "dinner"].filter(Boolean)
    for (const mt of meals) {
      const m = pick(mealsPool.filter((x) => x[0] === mt))
      s.meals.push({
        id: uid(), date: d, eaten_at: { breakfast: "08:30", lunch: "13:15", snack: "17:00", dinner: "21:00" }[mt]!, meal_type: mt as Meal["meal_type"],
        description: m[1], kcal: m[2], protein_g: m[3], carbs_g: m[4], fat_g: m[5], fiber_g: m[6], alcohol_g: 0, caffeine_mg: m[1].includes("cortado") ? 80 : 0, items: null, micros: null, source: "ai",
      })
    }
    const water = isToday ? 1250 : Math.round((2100 + rnd() * 1200) / 250) * 250
    for (let w = 0; w < water; w += 500) s.water.push({ id: uid(), date: d, ml: Math.min(500, water - w), logged_at: `${d}T${String(9 + w / 500).padStart(2, "0")}:00:00Z` })
    if (rnd() < 0.6) s.caffeine.push({ id: uid(), date: d, mg: 80, label: "Café", logged_at: `${d}T11:00:00Z` })
    weight += -0.02 + (rnd() - 0.5) * 0.08
    if (rnd() < 0.7 || isToday) s.weights.push({ id: uid(), date: d, kg: Math.round((weight + (rnd() - 0.5) * 0.6) * 10) / 10, body_fat_pct: null })

    // Device metrics (Pixel Watch via Google Health)
    const sleep = Math.round(390 + rnd() * 110)
    s.metrics.push({
      date: d, source: "google_health", device: "Pixel Watch 3", steps: isToday ? 6840 : Math.round(6500 + rnd() * 8000),
      distance_m: null, active_kcal: isToday ? 410 : Math.round(380 + rnd() * 420), resting_kcal: null, resting_hr: Math.round(52 + rnd() * 6),
      hrv_ms: Math.round(48 + rnd() * 20), sleep_min: sleep, flights: null,
    })

    // Gym (routine days) with progression, runs from Strava (Garmin) on Tue/Thu/Sun
    const routine = s.routines.find((x) => x.weekdays.includes(wd))
    const weeks = Math.floor((Date.parse(d) - Date.parse(start)) / (7 * 86_400_000))
    if (routine && !isToday && rnd() < 0.85) {
      const w: Omit<Workout, "sets"> = { id: uid(), date: d, routine_id: routine.id, name: routine.name, started_at: `${d}T21:00:00Z`, ended_at: `${d}T22:05:00Z`, notes: null, activity_id: null }
      s.workouts.push(w)
      for (const it of s.routineItems.filter((x) => x.routine_id === routine.id)) {
        const slug = it.exercise_id.replace(/^ex-/, "")
        const base = baseWeight.get(slug) ?? 0
        const kg = base ? Math.round((base + Math.floor(weeks / 3) * (["back-squat", "deadlift", "leg-press", "romanian-deadlift"].includes(slug) ? 5 : 2.5)) * 2) / 2 : 0
        for (let n = 1; n <= it.sets; n++) {
          s.sets.push({
            id: uid(), workout_id: w.id, exercise_id: it.exercise_id, position: it.position, set_no: n, weight_kg: kg,
            reps: Math.max(it.reps_min ?? 5, (it.reps_max ?? 10) - Math.floor(rnd() * 3) - (n > 2 ? 1 : 0)), duration_s: null, distance_m: null,
            rpe: 7 + Math.round(rnd() * 4) / 2, is_warmup: false, completed_at: `${d}T21:${String(5 + n * 4).padStart(2, "0")}:00Z`,
          })
        }
      }
    }
    if ([1, 3, 6].includes(wd) && !isToday && rnd() < 0.85) {
      const km = wd === 6 ? 12 + rnd() * 6 : 5 + rnd() * 3
      const min = Math.round(km * (5.2 + rnd() * 0.6))
      s.activities.push({
        id: uid(), source: "strava", external_id: uid(), type: "run", name: wd === 6 ? "Fondo de domingo" : "Rodaje", date: d,
        start_at: `${d}T10:10:00Z`, end_at: new Date(Date.parse(`${d}T10:10:00Z`) + min * 60_000).toISOString(), duration_s: min * 60,
        moving_s: min * 60, distance_m: Math.round(km * 1000), kcal: Math.round(km * 72), avg_hr: Math.round(145 + rnd() * 15), max_hr: 172,
        steps: null, elevation_m: Math.round(rnd() * 80), device: "Garmin Forerunner 265",
      })
      s.habitLogs.push({ habit_id: "h-run", date: d, source: "auto" })
    }

    // Work: tasks done, focus/coding time, inbox
    if (!isToday && wd < 5) {
      for (let i = 0; i < Math.floor(rnd() * 5); i++) {
        s.tasks.push({ id: uid(), title: pick(["Code review", "Fix bug de sync", "Escribir tests", "Deploy staging", "Reunión con producto", "Actualizar dependencias"]), notes: null, project_id: "p-work", priority: "medium", status: "done", due_date: d, completed_on: d, source: "manual", source_ref: null, position: 0, created_at: d })
      }
      const min = Math.round(90 + rnd() * 200)
      s.focus.push({ id: uid(), date: d, started_at: `${d}T12:00:00Z`, ended_at: new Date(Date.parse(`${d}T12:00:00Z`) + min * 60_000).toISOString(), kind: "coding", task_id: null })
    }
    inbox = Math.max(4, inbox + Math.round((rnd() - 0.45) * 9))
    const personal = Math.round(3 + rnd() * 6)
    const news = Math.round(8 + rnd() * 14)
    s.snapshots.push({
      date: d, account_email: "demo@gmail.com", inbox_total: inbox, unread: Math.round(inbox * 0.4), received: personal + news, sent: Math.round(rnd() * 8),
      personal, newsletters: news, promotions: Math.round(news * 0.6),
      top_senders: [
        { sender: "Medium Daily Digest", count: 1, unopened: rnd() < 0.8 ? 1 : 0, unsubscribe: "https://medium.com" },
        { sender: "LinkedIn", count: 2, unopened: rnd() < 0.7 ? 2 : 0 },
        { sender: "Mercado Libre", count: 1, unopened: 1 },
      ],
    })
    if (!isToday && rnd() < 0.5) s.checkins.push({ id: uid(), date: d, at: `${d}T18:00:00Z`, energy: 2 + Math.round(rnd() * 3), mood: 3 + Math.round(rnd() * 2), note: null })
  }

  // Today: open tasks, a code task on a branch, important email
  s.tasks.push(
    { id: uid(), title: "Revisar PR de auth en /api/v1", notes: null, project_id: "p-work", priority: "high", status: "todo", due_date: today, completed_on: null, source: "manual", source_ref: null, position: 0, created_at: today },
    { id: uid(), title: "Pagar expensas", notes: null, project_id: "p-personal", priority: "medium", status: "todo", due_date: addDays(today, -2), completed_on: null, source: "manual", source_ref: null, position: 1, created_at: today },
    { id: uid(), title: "Manejar refresh token expirado en Strava", notes: null, project_id: "p-tilo", priority: "medium", status: "todo", due_date: today, completed_on: null, source: "code", source_ref: { file: "/Users/demo/tiloApp/apps/web/lib/server/strava.ts", line: 64, branch: "fix/strava-refresh" }, position: 2, created_at: today },
    { id: uid(), title: "Schema de Supabase en producción", notes: null, project_id: "p-tilo", priority: "high", status: "todo", due_date: addDays(today, 2), completed_on: null, source: "manual", source_ref: null, position: 3, created_at: today },
    { id: uid(), title: "Turno dentista", notes: null, project_id: "p-personal", priority: "low", status: "todo", due_date: addDays(today, 6), completed_on: null, source: "manual", source_ref: null, position: 4, created_at: today },
    { id: uid(), title: "Comprar zapatillas de running", notes: null, project_id: "p-personal", priority: "low", status: "todo", due_date: null, completed_on: null, source: "manual", source_ref: null, position: 5, created_at: today },
    { id: uid(), title: "Deploy de índices", notes: null, project_id: "p-work", priority: "medium", status: "done", due_date: today, completed_on: today, source: "manual", source_ref: null, position: 6, created_at: today },
  )
  s.insights.push(
    { id: uid(), account_email: "demo@gmail.com", message_id: "m1", received_at: `${today}T09:12:00Z`, from_name: "Martina (cliente)", subject: "Re: propuesta Q4, ¿cerramos el viernes?", category: "reply", due_date: null },
    { id: uid(), account_email: "demo@gmail.com", message_id: "m2", received_at: `${today}T08:01:00Z`, from_name: "ARCA", subject: "Vencimiento monotributo", category: "deadline", due_date: addDays(today, 12) },
    { id: uid(), account_email: "demo@gmail.com", message_id: "m3", received_at: `${today}T07:40:00Z`, from_name: "Vercel", subject: "Your deployment usage this month", category: "fyi", due_date: null },
  )
  return s
}

// ---------- persistence ----------

let store: Store | null = null
function db(): Store {
  if (store) return store
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Store & { seededFor?: string }
      if (parsed.seededFor === localDate()) return (store = parsed)
    }
  } catch {}
  store = seed()
  save()
  return store
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...store, seededFor: localDate() }))
  } catch {}
}
export function resetDemo() {
  try {
    localStorage.removeItem(KEY)
  } catch {}
  store = null
}

// ---------- get_day / get_range equivalents ----------

function summaryFor(s: Store, date: string) {
  const meals = s.meals.filter((m) => m.date === date)
  const ws = s.workouts.filter((w) => w.date === date)
  const sets = s.sets.filter((x) => ws.some((w) => w.id === x.workout_id) && !x.is_warmup && x.completed_at)
  const acts = s.activities.filter((a) => a.date === date)
  const sum = (k: keyof Meal) => meals.reduce((t, m) => t + Number(m[k] ?? 0), 0)
  return {
    date, water_ml: s.water.filter((w) => w.date === date).reduce((t, w) => t + w.ml, 0),
    kcal_in: sum("kcal"), protein_g: sum("protein_g"), carbs_g: sum("carbs_g"), fat_g: sum("fat_g"), fiber_g: sum("fiber_g"),
    caffeine_mg: sum("caffeine_mg") + s.caffeine.filter((c) => c.date === date).reduce((t, c) => t + c.mg, 0),
    meals_count: meals.length, tasks_done: s.tasks.filter((t) => t.completed_on === date).length,
    habits_done: s.habitLogs.filter((l) => l.date === date).length, supplements_done: s.suppLogs.filter((l) => l.date === date).length,
    workouts: ws.length, sets_done: sets.length, volume_kg: sets.reduce((t, x) => t + Number(x.weight_kg ?? 0) * (x.reps ?? 0), 0),
    sport_min: Math.round(acts.reduce((t, a) => t + a.duration_s, 0) / 60 + ws.filter((w) => !w.activity_id && w.ended_at).reduce((t, w) => t + (Date.parse(w.ended_at!) - Date.parse(w.started_at)) / 60000, 0)),
  }
}

function buildDay(s: Store, date: string): DayData {
  const wd = dow(date)
  const weekStart = addDays(date, -wd)
  const routine = s.routines.find((r) => !r.archived && r.weekdays.includes(wd)) ?? null
  const lastFor = (exId: string) => {
    const prev = s.workouts.filter((w) => w.date < date && s.sets.some((x) => x.workout_id === w.id && x.exercise_id === exId)).sort((a, b) => b.date.localeCompare(a.date))[0]
    return prev ? s.sets.filter((x) => x.workout_id === prev.id && x.exercise_id === exId && !x.is_warmup).sort((a, b) => a.set_no - b.set_no).map((x) => ({ weight_kg: x.weight_kg, reps: x.reps, rpe: x.rpe })) : null
  }
  return {
    date,
    profile: s.profile,
    goals: s.goals,
    settings: s.settings,
    projects: s.projects,
    tasks: s.tasks.filter((t) => t.status === "todo" || t.completed_on === date).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")),
    habits: s.habits.filter((h) => !h.archived).map((h) => ({
      ...h,
      done: s.habitLogs.some((l) => l.habit_id === h.id && l.date === date),
      auto: s.habitLogs.some((l) => l.habit_id === h.id && l.date === date && l.source === "auto"),
      week_count: s.habitLogs.filter((l) => l.habit_id === h.id && l.date >= weekStart && l.date <= addDays(weekStart, 6)).length,
    })),
    supplements: s.supplements.filter((x) => !x.archived && x.days.includes(wd)).map((x) => ({ ...x, taken: s.suppLogs.some((l) => l.supplement_id === x.id && l.date === date) })),
    meals: s.meals.filter((m) => m.date === date).sort((a, b) => (a.eaten_at ?? "").localeCompare(b.eaten_at ?? "")),
    water: s.water.filter((w) => w.date === date),
    caffeine: s.caffeine.filter((c) => c.date === date),
    weight: [...s.weights].filter((w) => w.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    weights_recent: s.weights.filter((w) => w.date >= addDays(date, -28) && w.date <= date),
    routine: routine && {
      ...routine,
      items: s.routineItems.filter((i) => i.routine_id === routine.id).sort((a, b) => a.position - b.position).map((i) => {
        const e = EXERCISES.find((x) => exerciseId(x.slug) === i.exercise_id)
        return { ...i, exercise: { id: i.exercise_id, name: e?.name_es ?? exerciseName(i.exercise_id), primary_muscle: e?.primary ?? "full_body", kind: e?.kind ?? "strength" }, last: lastFor(i.exercise_id) }
      }),
    },
    workouts: s.workouts.filter((w) => w.date === date).map((w) => ({
      ...w,
      sets: s.sets.filter((x) => x.workout_id === w.id).sort((a, b) => a.position - b.position || a.set_no - b.set_no).map((x) => ({ ...x, exercise_name: exerciseName(x.exercise_id) })),
    })),
    activities: s.activities.filter((a) => a.date === date),
    metrics: s.metrics.filter((m) => m.date === date),
    energy: null,
    summary: summaryFor(s, date),
    email: {
      snapshots: s.snapshots.filter((x) => x.date >= addDays(date, -6) && x.date <= date),
      insights: s.insights.filter((i) => !i.dismissed && !i.task_id).slice(0, 10),
    },
    checkins: s.checkins.filter((c) => c.date === date),
    focus_min: Math.round(s.focus.filter((f) => f.date === date && f.kind !== "break").reduce((t, f) => t + (Date.parse(f.ended_at ?? new Date().toISOString()) - Date.parse(f.started_at)) / 60000, 0)),
  }
}

function buildRange(s: Store, from: string, to: string): RangeData {
  const dates: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)
  const withEnergy = dates.length <= 100
  const muscleSets = new Map<string, { date: string; muscle: string; sets: number; volume_kg: number }>()
  const best = new Map<string, { exercise_id: string; name: string; date: string; weight_kg: number; reps: number; e1rm: number }>()
  for (const w of s.workouts.filter((x) => x.date >= from && x.date <= to)) {
    for (const x of s.sets.filter((y) => y.workout_id === w.id && !y.is_warmup)) {
      const muscle = EXERCISES.find((e) => exerciseId(e.slug) === x.exercise_id)?.primary ?? "full_body"
      const k = `${w.date}|${muscle}`
      const m = muscleSets.get(k) ?? { date: w.date, muscle, sets: 0, volume_kg: 0 }
      m.sets++
      m.volume_kg += Number(x.weight_kg ?? 0) * (x.reps ?? 0)
      muscleSets.set(k, m)
      const v = e1rm(Number(x.weight_kg ?? 0), x.reps ?? 0)
      if (v && (!best.get(x.exercise_id) || v > best.get(x.exercise_id)!.e1rm)) {
        best.set(x.exercise_id, { exercise_id: x.exercise_id, name: exerciseName(x.exercise_id), date: w.date, weight_kg: Number(x.weight_kg), reps: x.reps ?? 0, e1rm: v })
      }
    }
  }
  return {
    from, to, goals: s.goals, settings: s.settings,
    summaries: dates.map((d) => summaryFor(s, d)),
    habits: s.habits.filter((h) => !h.archived).map((h) => ({ id: h.id, name: h.name, frequency: h.frequency, per_week: h.per_week, dates: s.habitLogs.filter((l) => l.habit_id === h.id && l.date >= from && l.date <= to).map((l) => l.date).sort() })),
    weights: s.weights.filter((w) => w.date >= from && w.date <= to),
    energy: withEnergy
      ? dates.filter((d) => d <= localDate()).map((d) => {
          const e = buildToday(buildDay(s, d)).energy
          return { date: d, bmr: e.bmr.kcal, neat: e.neat.kcal, exercise: e.exercise.kcal, tef: e.tef.kcal, total: e.total, intake: e.intake, calibration: 1, confidence: e.confidence }
        })
      : [],
    metrics: s.metrics.filter((m) => m.date >= from && m.date <= to),
    activities: s.activities.filter((a) => a.date >= from && a.date <= to).map(({ date, type, name, source, duration_s, distance_m, kcal, avg_hr }) => ({ date, type, name, source, duration_s, distance_m, kcal, avg_hr })),
    muscle_sets: [...muscleSets.values()],
    best_lifts: [...best.values()].sort((a, b) => b.e1rm - a.e1rm),
    email: s.snapshots.filter((x) => x.date >= from && x.date <= to),
    focus: dates.map((d) => ({ date: d, minutes: Math.round(s.focus.filter((f) => f.date === d).reduce((t, f) => t + (Date.parse(f.ended_at ?? f.started_at) - Date.parse(f.started_at)) / 60000, 0)) })).filter((f) => f.minutes > 0),
    checkins: s.checkins.filter((c) => c.date >= from && c.date <= to).map(({ date, energy, mood }) => ({ date, energy, mood })),
  }
}

// ---------- request router ----------

const TABLES: Record<string, keyof Store> = {
  tasks: "tasks", projects: "projects", habits: "habits", supplements: "supplements", meals: "meals", water_logs: "water",
  weight_logs: "weights", caffeine_logs: "caffeine", routines: "routines", routine_items: "routineItems", workouts: "workouts",
  workout_sets: "sets", activities: "activities", checkins: "checkins", email_insights: "insights", focus_sessions: "focus",
}

function estimateMeal(description: string) {
  const n = Math.max(1, (description.match(/\d+/g) ?? []).length)
  const kcal = Math.round((380 + description.length * 6) / 10) * 10 * Math.min(2, n)
  return { kcal, protein_g: Math.round(kcal * 0.07), carbs_g: Math.round(kcal * 0.11), fat_g: Math.round(kcal * 0.035), fiber_g: 4 }
}

function addSet(s: Store, workoutId: string, body: { exercise_id?: string; exercise_name?: string; weight_kg?: number; reps?: number; rpe?: number; is_warmup?: boolean }) {
  const exId = body.exercise_id ?? exerciseId(findExercise(body.exercise_name ?? "")?.slug ?? (body.exercise_name ?? "otro").toLowerCase().replace(/\W+/g, "-"))
  const same = s.sets.filter((x) => x.workout_id === workoutId && x.exercise_id === exId)
  const prev = s.sets.filter((x) => x.workout_id !== workoutId && x.exercise_id === exId && !x.is_warmup).map((x) => ({ weightKg: Number(x.weight_kg ?? 0), reps: x.reps ?? 0 }))
  const prevBest = bestSet(prev)?.e1rm ?? 0
  const set = {
    id: uid(), workout_id: workoutId, exercise_id: exId, position: same[0]?.position ?? s.sets.filter((x) => x.workout_id === workoutId).length, set_no: same.length + 1,
    weight_kg: body.weight_kg ?? null, reps: body.reps ?? null, duration_s: null, distance_m: null, rpe: body.rpe ?? null, is_warmup: !!body.is_warmup, completed_at: new Date().toISOString(),
  }
  s.sets.push(set)
  const v = e1rm(body.weight_kg ?? 0, body.reps ?? 0) ?? 0
  return { ...set, exercise_name: exerciseName(exId), records: { e1rm: prev.length > 0 && v > prevBest, weight: false } }
}

async function handle(method: string, path: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const s = db()
  const [route, qs] = path.split("?")
  const q = new URLSearchParams(qs ?? "")
  const parts = route.split("/").filter(Boolean)
  const date = (body.date as string) ?? q.get("date") ?? localDate()
  const today = localDate()

  if (route === "/day") return buildDay(s, date)
  if (route === "/range") return buildRange(s, q.get("from")!, q.get("to")!)
  if (route === "/sync") return { synced: 0, failed: 0 }
  if (route === "/calendar") {
    return { events: date === today ? [
      { id: "e1", title: "Daily standup", start: `${date}T13:00:00Z`, end: `${date}T13:15:00Z`, allDay: false, meetLink: "https://meet.google.com", account: "demo@gmail.com" },
      { id: "e2", title: "1:1 con Caro", start: `${date}T18:00:00Z`, end: `${date}T18:30:00Z`, allDay: false, meetLink: "https://meet.google.com", account: "demo@gmail.com" },
    ] : [] }
  }
  if (route === "/catalog") {
    return {
      habits: s.habits.filter((h) => !h.archived), supplements: s.supplements.filter((x) => !x.archived), projects: s.projects,
      routines: s.routines.filter((r) => !r.archived).map((r) => ({ ...r, items: s.routineItems.filter((i) => i.routine_id === r.id) })),
      exercises: EXERCISES.map((e) => ({ id: exerciseId(e.slug), user_id: null, name: e.name, name_es: e.name_es, primary_muscle: e.primary, kind: e.kind })),
    }
  }
  if (route === "/settings") {
    if (method === "GET") return { profile: s.profile, goals: s.goals, settings: { ...s.settings, ai: null } }
    Object.assign(s.profile, body.profile ?? {})
    Object.assign(s.goals, body.goals ?? {})
    Object.assign(s.settings, body.settings ?? {})
    save()
    return { ok: true }
  }
  if (route === "/connections") {
    if (method === "DELETE") return { ok: true }
    return {
      connections: [
        { provider: "strava", external_id: "1", account_email: null, display_name: "David Demo (Garmin → Strava)", scopes: ["activity:read_all"], status: "active", last_sync_at: new Date().toISOString(), last_error: null },
        { provider: "google", external_id: "2", account_email: "demo@gmail.com", display_name: "David Demo", scopes: ["gmail.readonly", "calendar.readonly", "googlehealth.activity_and_fitness.readonly"], status: "active", last_sync_at: new Date().toISOString(), last_error: null },
      ],
      deviceSources: [{ source: "google_health", device: "Pixel Watch 3", last_date: today, last_steps: s.metrics.find((m) => m.date === today)?.steps ?? null }],
    }
  }
  if (route === "/tokens") {
    if (method === "GET") return s.tokens
    const token = `tilo_demo${uid().replace(/-/g, "").slice(0, 24)}`
    s.tokens.unshift({ id: uid(), name: String(body.name ?? "API token"), preview: `${token.slice(0, 9)}…${token.slice(-4)}`, kind: "personal", createdAt: today, lastUsedAt: null })
    save()
    return { token }
  }
  if (parts[0] === "tokens" && method === "DELETE") {
    s.tokens = s.tokens.filter((t) => t.id !== parts[1])
    save()
    return { ok: true }
  }

  if (route === "/quick-add") {
    const p = parseQuickAdd(String(body.text), {
      today: date, habits: s.habits.map((h) => ({ id: h.id, name: h.name })),
      supplements: s.supplements.map((x) => ({ id: x.id, name: x.name, dose: x.dose, unit: x.unit })), projects: s.projects.map((x) => x.name),
    })
    if (!p) throw new Error("No entendí qué registrar")
    switch (p.kind) {
      case "water": s.water.push({ id: uid(), date, ml: p.ml, logged_at: new Date().toISOString() }); save(); return { kind: p.kind, saved: true, summary: `+${p.ml} ml de agua` }
      case "weight": s.weights.push({ id: uid(), date, kg: p.kg, body_fat_pct: p.bodyFatPct ?? null }); save(); return { kind: p.kind, saved: true, summary: `Peso ${p.kg} kg` }
      case "caffeine": s.caffeine.push({ id: uid(), date, mg: p.mg, label: p.label, logged_at: new Date().toISOString() }); save(); return { kind: p.kind, saved: true, summary: `${p.label} · ${p.mg} mg` }
      case "task": {
        const proj = s.projects.find((x) => x.name.toLowerCase() === p.project?.toLowerCase())
        s.tasks.push({ id: uid(), title: p.title, notes: null, project_id: proj?.id ?? null, priority: p.priority ?? "medium", status: "todo", due_date: p.dueDate ?? null, completed_on: null, source: "manual", source_ref: null, position: 99, created_at: today })
        save()
        return { kind: p.kind, saved: true, summary: `Tarea: ${p.title}` }
      }
      case "sets": {
        let w = s.workouts.find((x) => x.date === date && !x.ended_at)
        if (!w) {
          w = { id: uid(), date, routine_id: null, name: "Entrenamiento", started_at: new Date().toISOString(), ended_at: null, notes: null, activity_id: null }
          s.workouts.push(w)
        }
        let pr = false
        for (const x of p.sets) pr = addSet(s, w.id, { exercise_id: exerciseId(p.exercise.slug), weight_kg: x.weightKg, reps: x.reps, rpe: x.rpe }).records.e1rm || pr
        save()
        return { kind: p.kind, saved: true, summary: `${p.exercise.name_es} · ${p.sets.length} × ${p.sets[0].reps} @ ${p.sets[0].weightKg} kg${pr ? " · ¡récord!" : ""}` }
      }
      case "cardio": {
        const min = p.minutes ?? 30
        s.activities.push({ id: uid(), source: "manual", external_id: uid(), type: p.exercise.slug === "running" ? "run" : "other", name: p.exercise.name_es, date, start_at: new Date(Date.now() - min * 60000).toISOString(), end_at: new Date().toISOString(), duration_s: min * 60, moving_s: null, distance_m: p.distanceKm ? p.distanceKm * 1000 : null, kcal: null, avg_hr: null, max_hr: null, steps: null, elevation_m: null, device: null })
        save()
        return { kind: p.kind, saved: true, summary: `${p.exercise.name_es} · ${min} min` }
      }
      case "supplement": {
        const id = p.supplementId ?? s.supplements.find((x) => x.name === p.name)?.id
        if (id && !s.suppLogs.some((l) => l.supplement_id === id && l.date === date)) s.suppLogs.push({ supplement_id: id, date })
        save()
        return { kind: p.kind, saved: true, summary: `${p.name} tomado` }
      }
      case "habit":
        if (!s.habitLogs.some((l) => l.habit_id === p.habitId && l.date === date)) s.habitLogs.push({ habit_id: p.habitId, date, source: "manual" })
        save()
        return { kind: p.kind, saved: true, summary: `${p.name} ✓` }
      case "checkin":
        s.checkins.push({ id: uid(), date, at: new Date().toISOString(), energy: p.energy ?? null, mood: p.mood ?? null, note: null })
        save()
        return { kind: p.kind, saved: true, summary: "Check-in guardado" }
      case "meal": {
        const est = estimateMeal(p.description)
        const m: Meal = { id: uid(), date, eaten_at: new Date().toTimeString().slice(0, 5), meal_type: p.mealType ?? "snack", description: p.description, ...est, alcohol_g: 0, caffeine_mg: 0, items: null, micros: { _assumptions: "Estimación de demo" } as never, source: "ai" }
        s.meals.push(m)
        save()
        return { kind: p.kind, saved: true, summary: `${m.description} · ${m.kcal} kcal (estimación de demo)` }
      }
    }
  }

  if (parts[0] === "tasks") {
    if (method === "POST") {
      const proj = s.projects.find((x) => x.name.toLowerCase() === String(body.project ?? "").toLowerCase())
      const t: Task = { id: uid(), title: String(body.title), notes: null, project_id: proj?.id ?? null, priority: (body.priority as Task["priority"]) ?? "medium", status: "todo", due_date: (body.due_date as string) ?? null, completed_on: null, source: (body.source as Task["source"]) ?? "manual", source_ref: (body.source_ref as Record<string, unknown>) ?? null, position: 99, created_at: today }
      s.tasks.push(t)
      save()
      return t
    }
    const t = s.tasks.find((x) => x.id === parts[1])
    if (!t) throw new Error("Tarea no encontrada")
    if (method === "DELETE") s.tasks = s.tasks.filter((x) => x !== t)
    else {
      for (const k of ["title", "notes", "priority", "due_date", "project_id"] as const) if (k in body) (t as unknown as Record<string, unknown>)[k] = body[k]
      if (body.status) {
        t.status = body.status as Task["status"]
        t.completed_on = t.status === "done" ? date : null
      }
    }
    save()
    return t
  }
  if (parts[0] === "habits" && parts[2] === "log") {
    s.habitLogs = s.habitLogs.filter((l) => !(l.habit_id === parts[1] && l.date === date))
    if (body.done) s.habitLogs.push({ habit_id: parts[1], date, source: "manual" })
    save()
    return { ok: true }
  }
  if (parts[0] === "supplements" && parts[2] === "log") {
    const had = s.suppLogs.some((l) => l.supplement_id === parts[1] && l.date === date)
    s.suppLogs = s.suppLogs.filter((l) => !(l.supplement_id === parts[1] && l.date === date))
    const sp = s.supplements.find((x) => x.id === parts[1])
    if (body.taken) {
      s.suppLogs.push({ supplement_id: parts[1], date })
      if (sp?.stock_doses != null && !had) sp.stock_doses = Math.max(0, sp.stock_doses - 1)
    }
    save()
    return { ok: true }
  }
  if (route === "/water") {
    s.water.push({ id: uid(), date, ml: Number(body.ml), logged_at: new Date().toISOString() })
    save()
    return { total: s.water.filter((w) => w.date === date).reduce((t, w) => t + w.ml, 0), target: s.goals.water_ml }
  }
  if (route === "/meals") {
    const est = body.kcal != null ? { kcal: Number(body.kcal), protein_g: Number(body.protein_g ?? 0), carbs_g: Number(body.carbs_g ?? 0), fat_g: Number(body.fat_g ?? 0), fiber_g: Number(body.fiber_g ?? 0) } : estimateMeal(String(body.description))
    const m: Meal = { id: uid(), date, eaten_at: (body.eaten_at as string) ?? null, meal_type: (body.meal_type as Meal["meal_type"]) ?? "snack", description: String(body.description), ...est, alcohol_g: 0, caffeine_mg: 0, items: null, micros: null, source: "ai" }
    s.meals.push(m)
    save()
    return m
  }
  if (route === "/weight") {
    s.weights.push({ id: uid(), date, kg: Number(body.kg), body_fat_pct: (body.body_fat_pct as number) ?? null })
    save()
    return { ok: true }
  }
  if (parts[0] === "workouts") {
    if (parts.length === 1) {
      const r = s.routines.find((x) => x.id === body.routine_id)
      const w = { id: uid(), date, routine_id: (body.routine_id as string) ?? null, name: (body.name as string) ?? r?.name ?? "Entrenamiento", started_at: new Date().toISOString(), ended_at: null, notes: null, activity_id: null }
      s.workouts.push(w)
      save()
      return { ...w, sets: [] }
    }
    if (parts[2] === "sets") {
      const r = addSet(s, parts[1], body)
      save()
      return r
    }
    const w = s.workouts.find((x) => x.id === parts[1])!
    if (method === "DELETE") s.workouts = s.workouts.filter((x) => x !== w)
    else {
      if (body.finish) w.ended_at = w.ended_at ?? new Date().toISOString()
      if ("notes" in body) w.notes = (body.notes as string) ?? null
    }
    save()
    return { ...w, sets: s.sets.filter((x) => x.workout_id === w.id).map((x) => ({ ...x, exercise_name: exerciseName(x.exercise_id) })) }
  }
  if (route === "/checkins") {
    const c = { id: uid(), date, at: new Date().toISOString(), energy: (body.energy as number) ?? null, mood: (body.mood as number) ?? null, note: (body.note as string) ?? null }
    s.checkins.push(c)
    save()
    return c
  }
  if (parts[0] === "focus") {
    if (parts.length === 1) {
      const f = { id: uid(), date, started_at: new Date().toISOString(), ended_at: null, kind: (body.kind as string) ?? "focus", task_id: (body.task_id as string) ?? null }
      s.focus.push(f)
      save()
      return { id: f.id }
    }
    const f = s.focus.find((x) => x.id === parts[1])!
    f.ended_at = new Date().toISOString()
    save()
    return { minutes: Math.round((Date.parse(f.ended_at) - Date.parse(f.started_at)) / 60000) }
  }
  if (parts[0] === "crud") {
    const key = TABLES[parts[1]]
    if (!key) throw new Error(`Tabla desconocida: ${parts[1]}`)
    const list = s[key] as unknown as Record<string, unknown>[]
    const values = (body.values ?? {}) as Record<string, unknown>
    const id = q.get("id")
    if (method === "POST") {
      const row = { id: uid(), ...defaultsFor(parts[1], date), ...values }
      list.push(row)
      save()
      return row
    }
    const row = list.find((x) => x.id === id)
    if (!row) throw new Error("No encontrado")
    if (method === "DELETE") (s as unknown as Record<string, unknown>)[key] = list.filter((x) => x !== row)
    else Object.assign(row, values)
    save()
    return row
  }
  throw new Error(`Demo: ${method} ${route} no está simulado`)
}

function defaultsFor(table: string, date: string): Record<string, unknown> {
  switch (table) {
    case "habits": return { frequency: "daily", per_week: 7, reminder_time: null, auto_rule: null, position: 99 }
    case "supplements": return { dose: 1, unit: "caps", slot: "any", days: [0, 1, 2, 3, 4, 5, 6], with_food: false, stock_doses: null, nutrients: null, position: 99 }
    case "routines": return { weekdays: [], notes: null }
    case "routine_items": return { sets: 3, reps_min: 8, reps_max: 12, rpe: null, rest_sec: 120, superset_group: null, notes: null }
    case "projects": return { color: "#2f9e5f", position: 99 }
    case "focus_sessions": return { date, kind: "coding", task_id: null }
    default: return { date }
  }
}

// Same interface as the real client; requests are answered in memory after a short delay
export class DemoClient extends TiloClient {
  constructor() {
    super("")
  }

  override async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await new Promise((r) => setTimeout(r, 120))
    const result = await handle(method, path, (body ?? {}) as Record<string, unknown>)
    return structuredClone(result) as T
  }
}
