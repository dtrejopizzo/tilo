import { apiRoute, BadRequestError, NotFoundError, readJson } from "@/lib/server/apiRoute"
import { userDb } from "@/lib/server/userDb"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"

// Generic create / update / delete for everything the web app edits in place.
// Only listed tables and columns are writable; referenced ids must belong to the caller.
const ENTITIES: Record<string, string[]> = {
  tasks: ["title", "notes", "project_id", "priority", "due_date", "position"],
  projects: ["name", "color", "position", "archived"],
  habits: ["name", "frequency", "per_week", "days", "reminder_time", "auto_rule", "position", "archived"],
  supplements: ["name", "dose", "unit", "slot", "days", "with_food", "stock_doses", "nutrients", "position", "archived"],
  meals: ["date", "eaten_at", "meal_type", "description", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "alcohol_g", "caffeine_mg"],
  water_logs: ["date", "ml"],
  weight_logs: ["date", "kg", "body_fat_pct"],
  caffeine_logs: ["date", "mg", "label"],
  routines: ["name", "weekdays", "notes", "position", "archived"],
  routine_items: ["routine_id", "exercise_id", "position", "sets", "reps_min", "reps_max", "rpe", "rest_sec", "superset_group", "notes"],
  workouts: ["name", "notes", "date", "started_at", "ended_at", "routine_id"],
  workout_sets: ["weight_kg", "reps", "rpe", "is_warmup", "duration_s", "distance_m", "position", "set_no"],
  activities: ["name", "type", "date", "start_at", "end_at", "duration_s", "distance_m", "kcal", "avg_hr"],
  exercises: ["name", "name_es", "primary_muscle", "secondary_muscles", "equipment", "kind", "met"],
  checkins: ["energy", "mood", "note"],
  email_insights: ["dismissed", "task_id"],
  focus_sessions: ["date", "started_at", "ended_at", "kind", "source", "task_id", "planned_min"],
}

// Foreign keys a user could point at someone else's rows
const OWNED_REFS: Record<string, string> = {
  project_id: "projects", routine_id: "routines", task_id: "tasks",
}

async function checkRefs(uid: string, values: Record<string, unknown>) {
  for (const [col, table] of Object.entries(OWNED_REFS)) {
    if (values[col]) {
      const { data } = await userDb(uid).select(table, "id").eq("id", values[col] as string).maybeSingle()
      if (!data) throw new BadRequestError(`${col} not found`)
    }
  }
  if (values.exercise_id) {
    const { data } = await supabaseAdmin().from("exercises").select("user_id").eq("id", values.exercise_id as string).maybeSingle()
    if (!data || (data.user_id && data.user_id !== uid)) throw new BadRequestError("exercise_id not found")
  }
}

function clean(table: string, input: unknown): Record<string, unknown> {
  const cols = ENTITIES[table]
  if (!cols) throw new NotFoundError(`Unknown table ${table}`)
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestError("values must be an object")
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!cols.includes(k)) throw new BadRequestError(`${table}.${k} can't be edited`)
    out[k] = v === "" ? null : v
  }
  return out
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

// POST { values } → created row
export const POST = apiRoute(async ({ uid, req, params }) => {
  const values = clean(params.table, (await readJson(req)).values)
  await checkRefs(uid, values)
  if (params.table === "exercises") values.slug = slugify(String(values.name ?? ""))
  if (params.table === "workout_sets") throw new BadRequestError("Use POST /api/v1/workouts/:id/sets")
  const { data, error } = await supabaseAdmin().from(params.table).insert({ ...values, user_id: uid }).select("*").single()
  if (error) throw new BadRequestError(error.message)
  return data
})

// PATCH ?id= { values } → updated row
export const PATCH = apiRoute(async ({ uid, req, params }) => {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) throw new BadRequestError("id is required")
  const values = clean(params.table, (await readJson(req)).values)
  await checkRefs(uid, values)
  const { data, error } = await userDb(uid).update(params.table, values).eq("id", id).select("*").maybeSingle()
  if (error) throw new BadRequestError(error.message)
  if (!data) throw new NotFoundError("Not found")
  return data
})

// DELETE ?id=
export const DELETE = apiRoute(async ({ uid, req, params }) => {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) throw new BadRequestError("id is required")
  if (!ENTITIES[params.table]) throw new NotFoundError(`Unknown table ${params.table}`)
  const { data, error } = await userDb(uid).delete(params.table).eq("id", id).select("id")
  if (error) throw new BadRequestError(error.message)
  if (!data?.length) throw new NotFoundError("Not found")
})
