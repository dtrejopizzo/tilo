// Shapes shared by the database RPCs (get_day / get_range), the /api/v1 endpoints,
// the web app, the VSCode extension and the MCP server. Keep this file dependency-free.

export type Priority = "low" | "medium" | "high"
export type Sex = "male" | "female"
export type SupplementUnit = "mg" | "mcg" | "iu" | "g" | "ml" | "caps" | "scoop"
export type SupplementSlot = "wake" | "breakfast" | "lunch" | "dinner" | "with_meal" | "pre_workout" | "post_workout" | "bed" | "any"
export type MetricSource = "apple" | "google_health" | "health_connect" | "strava" | "garmin" | "manual"

export interface Profile {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
  birth_date: string | null
  sex: Sex | null
  height_cm: number | null
  body_fat_pct: number | null
  activity_level: number
  timezone: string
  onboarding_done: boolean
  plan: "free" | "trial" | "pro"
  trial_ends_at: string
}

export interface Goals {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  water_ml: number
  steps: number
  sleep_min: number
  weight_target_kg: number | null
  weight_target_date: string | null
  caffeine_max_mg: number
  caffeine_cutoff: string
  weekly_sets_target: number
}

export interface Project {
  id: string
  name: string
  color: string
  position: number
}

export interface Task {
  id: string
  title: string
  notes: string | null
  project_id: string | null
  priority: Priority
  status: "todo" | "done"
  due_date: string | null
  completed_on: string | null
  source: "manual" | "code" | "email" | "mcp" | "import"
  source_ref: Record<string, unknown> | null
  position: number
  created_at: string
}

export interface Habit {
  id: string
  name: string
  frequency: "daily" | "weekly"
  per_week: number
  days: number[] // 0 = Monday … 6 = Sunday; the habit is expected (and reminded) on these days
  reminder_time: string | null
  auto_rule: { activity_types?: string[]; min_minutes?: number } | null
  position: number
  done: boolean
  auto: boolean
  week_count: number
}

export interface Supplement {
  id: string
  name: string
  dose: number
  unit: SupplementUnit
  slot: SupplementSlot
  days: number[]
  with_food: boolean
  stock_doses: number | null
  nutrients: Record<string, number> | null
  position: number
  taken: boolean
}

export type MealType = "breakfast" | "morning_snack" | "lunch" | "merienda" | "afternoon_snack" | "dinner" | "snack"

// In the order of the day, with the words people use for each
export const MEAL_TYPES: { type: MealType; label: string }[] = [
  { type: "breakfast", label: "Desayuno" },
  { type: "morning_snack", label: "Colación mañana" },
  { type: "lunch", label: "Almuerzo" },
  { type: "merienda", label: "Merienda" },
  { type: "afternoon_snack", label: "Colación tarde" },
  { type: "dinner", label: "Cena" },
  { type: "snack", label: "Colación extra" },
]

export interface Meal {
  id: string
  date: string
  eaten_at: string | null
  meal_type: MealType | null
  description: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  alcohol_g: number
  caffeine_mg: number
  items: { name: string; grams?: number; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number }[] | null
  micros: Record<string, number> | null
  source: "manual" | "ai" | "mcp" | "import"
}

export interface Exercise {
  id: string
  name: string
  primary_muscle: string
  kind: "strength" | "cardio" | "mobility"
}

export interface RoutineItem {
  id: string
  exercise_id: string
  exercise: Exercise
  position: number
  sets: number
  reps_min: number | null
  reps_max: number | null
  rpe: number | null
  rest_sec: number
  superset_group: number | null
  notes: string | null
  last: { weight_kg: number | null; reps: number | null; rpe: number | null }[] | null
}

export interface Routine {
  id: string
  name: string
  weekdays: number[]
  notes: string | null
  items: RoutineItem[]
}

export interface WorkoutSet {
  id: string
  workout_id: string
  exercise_id: string
  exercise_name: string
  position: number
  set_no: number
  weight_kg: number | null
  reps: number | null
  duration_s: number | null
  distance_m: number | null
  rpe: number | null
  is_warmup: boolean
  completed_at: string | null
}

export interface Workout {
  id: string
  date: string
  routine_id: string | null
  name: string
  started_at: string
  ended_at: string | null
  notes: string | null
  activity_id: string | null
  sets: WorkoutSet[]
}

export interface Activity {
  id: string
  source: MetricSource
  external_id: string
  type: string
  name: string | null
  date: string
  start_at: string
  end_at: string
  duration_s: number
  moving_s: number | null
  distance_m: number | null
  kcal: number | null
  avg_hr: number | null
  max_hr: number | null
  steps: number | null
  elevation_m: number | null
  device: string | null
}

export interface DailyMetric {
  date: string
  source: MetricSource
  device: string | null
  steps: number | null
  distance_m: number | null
  active_kcal: number | null
  resting_kcal: number | null
  resting_hr: number | null
  hrv_ms: number | null
  sleep_min: number | null
  flights: number | null
  irregular_rhythm_events?: number | null // Apple Watch irregular rhythm notifications that day
}

export interface EnergyDay {
  date: string
  bmr: number
  neat: number
  exercise: number
  tef: number
  total: number
  intake: number
  calibration: number
  confidence: "high" | "medium" | "low"
  details?: Record<string, unknown>
}

export interface DailySummary {
  date: string
  water_ml: number
  kcal_in: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  caffeine_mg: number
  meals_count: number
  tasks_done: number
  habits_done: number
  supplements_done: number
  workouts: number
  sets_done: number
  volume_kg: number
  sport_min: number
}

export interface EmailSnapshot {
  date: string
  account_email: string
  inbox_total: number
  unread: number
  received: number
  sent: number
  personal: number
  newsletters: number
  promotions: number
  top_senders: { sender: string; count: number; unopened: number; unsubscribe?: string }[] | null
}

export interface EmailInsight {
  id: string
  account_email: string
  message_id: string
  received_at: string | null
  from_name: string | null
  subject: string | null
  category: "reply" | "deadline" | "fyi"
  due_date: string | null
}

export interface Checkin {
  id: string
  date: string
  at: string
  energy: number | null
  mood: number | null
  note: string | null
}

// public.get_day(date)
export interface DayData {
  date: string
  profile: Profile
  goals: Goals
  settings: Record<string, unknown> | null
  projects: Project[]
  tasks: Task[]
  habits: Habit[]
  supplements: Supplement[]
  meals: Meal[]
  water: { id: string; ml: number; logged_at: string }[]
  caffeine: { id: string; mg: number; label: string | null; logged_at: string }[]
  weight: { date: string; kg: number; body_fat_pct: number | null } | null
  weights_recent: { date: string; kg: number; body_fat_pct: number | null }[]
  routine: Routine | null
  workouts: Workout[]
  activities: Activity[]
  metrics: DailyMetric[]
  energy: EnergyDay | null
  summary: DailySummary | null
  email: { snapshots: EmailSnapshot[]; insights: EmailInsight[] }
  checkins: Checkin[]
  focus_min: number
}

// public.get_range(from, to)
export interface RangeData {
  from: string
  to: string
  goals: Goals
  settings?: Record<string, unknown> | null
  summaries: DailySummary[]
  habits: { id: string; name: string; frequency: "daily" | "weekly"; per_week: number; days?: number[]; dates: string[] }[]
  weights: { date: string; kg: number; body_fat_pct: number | null }[]
  energy: EnergyDay[]
  metrics: DailyMetric[]
  activities: { date: string; type: string; name: string | null; source: MetricSource; duration_s: number; distance_m: number | null; kcal: number | null; avg_hr: number | null }[]
  muscle_sets: { date: string; muscle: string; sets: number; volume_kg: number }[]
  best_lifts: { exercise_id: string; name: string; date: string; weight_kg: number; reps: number; e1rm: number }[]
  email: { date: string; inbox_total: number; unread: number; received: number; sent: number; personal: number; newsletters: number; promotions: number }[]
  focus: { date: string; minutes: number }[]
  checkins: { date: string; energy: number | null; mood: number | null }[]
}

// ---------- Stats model consumed by stats.ts / statsHtml.ts ----------

export interface DayStats {
  date: string
  tasksCompleted: number
  water: number
  calories: number
  mealsLogged: number
  sportMinutes: number
  steps?: number | null
  kcalOut?: number | null
  protein?: number
  sleepMin?: number | null
  focusMin?: number
  inboxTotal?: number | null
  unread?: number | null
  personalMail?: number | null
  newsletters?: number | null
}

export interface StatsResponse {
  from: string
  to: string
  targets: { calories: number; water: number; steps?: number; protein?: number; weeklySets?: number; sleepMin?: number; freezesPerMonth?: number }
  days: DayStats[] // one entry per day from `from` to `to`, inclusive
  habits: { id: string; name: string; frequency: "Daily" | "Weekly"; days?: number[]; completedDates: string[] }[] // days: 0 = Monday … 6 = Sunday; missing = every day
  weight: { date: string; value: number }[]
  muscles?: { date: string; muscle: string; sets: number; volumeKg: number }[]
  lifts?: { name: string; date: string; weightKg: number; reps: number; e1rm: number }[]
}

// ---------- API ----------

export interface ApiTokenInfo {
  id: string
  name: string
  preview: string
  kind: "personal" | "mcp_oauth" | "ingest"
  createdAt: string | null
  lastUsedAt: string | null
}

export interface QuickAddResponse {
  kind: string
  saved: boolean
  summary: string // one line for toasts / chat, e.g. "Press banca · 3 × 8 @ 80 kg"
  id?: string
  details?: Record<string, unknown>
}

// POST /api/v1/ingest
export interface IngestPayload {
  source: MetricSource
  device?: string
  timezone?: string
  daily?: (Partial<Omit<DailyMetric, "source" | "device">> & { date: string })[]
  activities?: {
    external_id: string
    type: string
    name?: string
    start_at: string
    end_at: string
    duration_s?: number
    distance_m?: number
    kcal?: number
    kcal_is_net?: boolean
    avg_hr?: number
    max_hr?: number
    steps?: number
    elevation_m?: number
    raw?: Record<string, unknown> // provider-specific extras, kept for diagnostics
  }[]
  weights?: { date: string; kg: number; body_fat_pct?: number }[]
}

export interface IngestResult {
  daily: number
  activities: number
  merged: number
  weights: number
}
