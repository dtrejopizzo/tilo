import type {
  ApiTokenInfo,
  Checkin,
  DayData,
  IngestPayload,
  IngestResult,
  Meal,
  Priority,
  QuickAddResponse,
  RangeData,
  Task,
  Workout,
  WorkoutSet,
} from "./apiTypes"

export type * from "./apiTypes"

export class TiloApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

// The user's local date; the API stores days as YYYY-MM-DD in local time
export function localDate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export interface NewMeal {
  description: string
  date?: string
  meal_type?: Meal["meal_type"]
  eaten_at?: string
  // Pass macros when the caller already estimated them (e.g. the user's own AI via MCP);
  // otherwise Tilo estimates them.
  kcal?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
  fiber_g?: number
}

export interface NewSet {
  exercise_id?: string
  exercise_name?: string // resolved against the exercise library when no id is given
  weight_kg?: number
  reps?: number
  rpe?: number
  is_warmup?: boolean
  duration_s?: number
  distance_m?: number
}

// Everything the MCP tools and the VSCode extension need. Implemented over HTTP by
// TiloClient and in-process by the web server for the remote MCP endpoint.
export interface TiloApi {
  getDay(date?: string): Promise<DayData>
  getRange(from: string, to: string): Promise<RangeData>
  quickAdd(text: string, date?: string): Promise<QuickAddResponse>
  addTask(input: { title: string; due_date?: string; priority?: Priority; project?: string; notes?: string; source?: Task["source"]; source_ref?: Record<string, unknown> }): Promise<Task>
  updateTask(id: string, patch: Partial<Pick<Task, "title" | "notes" | "priority" | "due_date" | "status" | "project_id">>, date?: string): Promise<Task>
  setHabit(id: string, done: boolean, date?: string): Promise<{ ok: true }>
  setSupplement(id: string, taken: boolean, date?: string): Promise<{ ok: true }>
  addWater(ml: number, date?: string): Promise<{ total: number; target: number }>
  addMeal(meal: NewMeal): Promise<Meal>
  addWeight(kg: number, bodyFatPct?: number, date?: string): Promise<{ ok: true }>
  startWorkout(input: { name?: string; routine_id?: string; date?: string }): Promise<Workout>
  addSet(workoutId: string, set: NewSet): Promise<WorkoutSet & { records?: { e1rm: boolean; weight: boolean } }>
  finishWorkout(workoutId: string, notes?: string): Promise<Workout>
  addCheckin(input: { energy?: number; mood?: number; note?: string; date?: string }): Promise<Checkin>
  startFocus(input: { task_id?: string; planned_min?: number; kind?: "focus" | "coding"; source?: "web" | "vscode" | "mcp"; date?: string }): Promise<{ id: string }>
  stopFocus(id: string): Promise<{ minutes: number }>
}

// HTTP client for the Tilo /api/v1 endpoints. With a token it authenticates as that token
// (VSCode, local MCP); without one it relies on the browser's session cookie (web app).
export class TiloClient implements TiloApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
      method,
      credentials: this.token ? "omit" : "same-origin",
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message =
        response.status === 401 ? "Invalid or revoked Tilo API token" :
        response.status === 402 ? (data.error ?? "This needs Tilo Pro or your own AI key") :
        data.error || `HTTP ${response.status}`
      throw new TiloApiError(message, response.status)
    }
    return data as T
  }

  getDay(date = localDate()) {
    return this.request<DayData>("GET", `/day?date=${date}`)
  }
  getRange(from: string, to: string) {
    return this.request<RangeData>("GET", `/range?from=${from}&to=${to}`)
  }
  quickAdd(text: string, date = localDate()) {
    return this.request<QuickAddResponse>("POST", "/quick-add", { text, date })
  }
  addTask(input: Parameters<TiloApi["addTask"]>[0]) {
    return this.request<Task>("POST", "/tasks", input)
  }
  updateTask(id: string, patch: Parameters<TiloApi["updateTask"]>[1], date = localDate()) {
    return this.request<Task>("PATCH", `/tasks/${encodeURIComponent(id)}`, { ...patch, date })
  }
  setHabit(id: string, done: boolean, date = localDate()) {
    return this.request<{ ok: true }>("PUT", `/habits/${encodeURIComponent(id)}/log`, { done, date })
  }
  setSupplement(id: string, taken: boolean, date = localDate()) {
    return this.request<{ ok: true }>("PUT", `/supplements/${encodeURIComponent(id)}/log`, { taken, date })
  }
  addWater(ml: number, date = localDate()) {
    return this.request<{ total: number; target: number }>("POST", "/water", { ml, date })
  }
  addMeal(meal: NewMeal) {
    return this.request<Meal>("POST", "/meals", { date: localDate(), ...meal })
  }
  addWeight(kg: number, bodyFatPct?: number, date = localDate()) {
    return this.request<{ ok: true }>("POST", "/weight", { kg, body_fat_pct: bodyFatPct, date })
  }
  startWorkout(input: { name?: string; routine_id?: string; date?: string }) {
    return this.request<Workout>("POST", "/workouts", { date: localDate(), ...input })
  }
  addSet(workoutId: string, set: NewSet) {
    return this.request<WorkoutSet & { records?: { e1rm: boolean; weight: boolean } }>("POST", `/workouts/${encodeURIComponent(workoutId)}/sets`, set)
  }
  finishWorkout(workoutId: string, notes?: string) {
    return this.request<Workout>("PATCH", `/workouts/${encodeURIComponent(workoutId)}`, { finish: true, notes })
  }
  addCheckin(input: { energy?: number; mood?: number; note?: string; date?: string }) {
    return this.request<Checkin>("POST", "/checkins", { date: localDate(), ...input })
  }
  startFocus(input: Parameters<TiloApi["startFocus"]>[0]) {
    return this.request<{ id: string }>("POST", "/focus", { date: localDate(), ...input })
  }
  stopFocus(id: string) {
    return this.request<{ minutes: number }>("PATCH", `/focus/${encodeURIComponent(id)}`, { stop: true })
  }

  // Not part of TiloApi: account and device sync
  listTokens() {
    return this.request<ApiTokenInfo[]>("GET", "/tokens")
  }
  ingest(payload: IngestPayload) {
    return this.request<IngestResult>("POST", "/ingest", payload)
  }
}
