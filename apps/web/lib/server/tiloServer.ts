// Server-side implementation of TiloApi for one user. Used by the /api/v1 routes (web app,
// VSCode extension, local MCP) and in-process by the remote MCP endpoint.
import type { Checkin, DayData, Meal, QuickAddResponse, RangeData, Task, Workout, WorkoutSet } from "@tilo/core/apiTypes"
import type { NewMeal, NewSet, TiloApi } from "@tilo/core/client"
import { findExercise } from "@tilo/core/exercises"
import { parseQuickAdd } from "@tilo/core/quickAdd"
import { findPreset, SUPPLEMENT_PRESETS } from "@tilo/core/supplements"
import { buildToday } from "@tilo/core/today"
import { bestSet, checkRecords, e1rm, volume } from "@tilo/core/training"
import { supabaseAdmin } from "../supabase/server"
import { BadRequestError, NotFoundError } from "./apiRoute"
import { estimateMeal } from "./ai"
import { must, userDb, type UserDb } from "./userDb"

const CARDIO_TYPE: Record<string, string> = {
  running: "run", treadmill: "run", walking: "walk", "incline-walk": "walk", hiking: "hike", cycling: "ride",
  "indoor-cycling": "ride", swimming: "swim", rowing: "rowing", elliptical: "elliptical", hiit: "hiit", tennis: "tennis",
  padel: "padel", football: "football", yoga: "yoga", pilates: "yoga",
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export class ServerTiloApi implements TiloApi {
  private db: UserDb

  constructor(readonly userId: string) {
    this.db = userDb(userId)
  }

  // ---------- reads ----------

  async getDay(date: string): Promise<DayData> {
    const day = must(await this.db.rpc<DayData>("get_day", { p_date: date }), "get_day")
    // Keep the energy cache that Stats reads in sync with what the user sees
    void this.cacheEnergy(day).catch((e) => console.error("[energy] cache failed:", e))
    return day
  }

  async getRange(from: string, to: string): Promise<RangeData> {
    return must(await this.db.rpc<RangeData>("get_range", { p_from: from, p_to: to }), "get_range")
  }

  async cacheEnergy(day: DayData) {
    const e = buildToday(day).energy
    const cached = day.energy
    if (cached && cached.total === e.total && cached.intake === e.intake) return
    await this.db.upsert(
      "energy_days",
      {
        date: day.date, bmr: e.bmr.kcal, neat: e.neat.kcal, exercise: e.exercise.kcal, tef: e.tef.kcal, total: e.total,
        intake: e.intake, calibration: e.calibration, confidence: e.confidence,
        details: { bmr: e.bmr.method, neat: e.neat.method, exercise: e.exercise.sessions, tef: e.tef.method },
        updated_at: new Date().toISOString(),
      },
      "user_id,date",
    )
  }

  // ---------- quick add ----------

  async quickAdd(text: string, date: string): Promise<QuickAddResponse> {
    const [habits, supplements, projects] = await Promise.all([
      this.db.select("habits", "id, name").eq("archived", false),
      this.db.select("supplements", "id, name, dose, unit").eq("archived", false),
      this.db.select("projects", "name").eq("archived", false),
    ])
    const parsed = parseQuickAdd(text, {
      today: date,
      habits: (habits.data ?? []) as unknown as { id: string; name: string }[],
      supplements: (supplements.data ?? []) as never,
      projects: ((projects.data ?? []) as unknown as { name: string }[]).map((p) => p.name),
    })
    if (!parsed) throw new BadRequestError("Nothing to log")

    switch (parsed.kind) {
      case "water": {
        const r = await this.addWater(parsed.ml, date)
        return { kind: "water", saved: true, summary: `+${parsed.ml} ml de agua · ${(r.total / 1000).toFixed(2)} / ${(r.target / 1000).toFixed(1)} L` }
      }
      case "weight":
        await this.addWeight(parsed.kg, parsed.bodyFatPct, date)
        return { kind: "weight", saved: true, summary: `Peso ${parsed.kg} kg${parsed.bodyFatPct ? ` · ${parsed.bodyFatPct}% grasa` : ""}` }
      case "caffeine":
        must(await this.db.insert("caffeine_logs", { date, mg: parsed.mg, label: parsed.label }), "caffeine")
        return { kind: "caffeine", saved: true, summary: `${parsed.label} · ${parsed.mg} mg de cafeína` }
      case "task": {
        const t = await this.addTask({ title: parsed.title, due_date: parsed.dueDate, priority: parsed.priority, project: parsed.project })
        return { kind: "task", saved: true, id: t.id, summary: `Tarea: ${t.title}${t.due_date ? ` · ${t.due_date}` : ""}` }
      }
      case "sets": {
        const w = await this.openWorkout(date)
        let last: (WorkoutSet & { records?: { e1rm: boolean; weight: boolean } }) | null = null
        for (const s of parsed.sets) {
          last = await this.addSet(w.id, { exercise_name: parsed.exercise.name_es, weight_kg: s.weightKg, reps: s.reps, rpe: s.rpe })
        }
        const pr = last?.records?.e1rm ? " · ¡récord!" : ""
        const reps = [...new Set(parsed.sets.map((s) => s.reps))]
        return {
          kind: "sets", saved: true, id: w.id,
          summary: `${parsed.exercise.name_es} · ${parsed.sets.length} × ${reps.length === 1 ? reps[0] : parsed.sets.map((s) => s.reps).join(",")} @ ${parsed.sets[0].weightKg || "BW"} kg${pr}`,
        }
      }
      case "cardio": {
        const minutes = parsed.minutes ?? (parsed.distanceKm ? Math.round(parsed.distanceKm * 6) : 30)
        const end = new Date()
        const start = new Date(end.getTime() - minutes * 60_000)
        must(
          await this.db.insert("activities", {
            source: "manual", external_id: crypto.randomUUID(), type: CARDIO_TYPE[parsed.exercise.slug] ?? "other",
            name: parsed.exercise.name_es, date, start_at: start.toISOString(), end_at: end.toISOString(), duration_s: minutes * 60,
            distance_m: parsed.distanceKm != null ? parsed.distanceKm * 1000 : null,
          }),
          "activity",
        )
        return { kind: "cardio", saved: true, summary: `${parsed.exercise.name_es} · ${minutes} min${parsed.distanceKm ? ` · ${parsed.distanceKm} km` : ""}` }
      }
      case "supplement": {
        const id = parsed.supplementId ?? (await this.supplementFromPreset(parsed.presetKey, parsed.name, parsed.dose))
        await this.setSupplement(id, true, date)
        return { kind: "supplement", saved: true, id, summary: `${parsed.name} tomado` }
      }
      case "habit":
        await this.setHabit(parsed.habitId, true, date)
        return { kind: "habit", saved: true, id: parsed.habitId, summary: `${parsed.name} ✓` }
      case "checkin": {
        const c = await this.addCheckin({ energy: parsed.energy, mood: parsed.mood, date })
        return { kind: "checkin", saved: true, id: c.id, summary: `Check-in${parsed.energy ? ` · energía ${parsed.energy}` : ""}${parsed.mood ? ` · ánimo ${parsed.mood}` : ""}` }
      }
      case "meal": {
        const m = await this.addMeal({ description: parsed.description, meal_type: parsed.mealType, date })
        return {
          kind: "meal", saved: true, id: m.id,
          summary: `${m.description} · ${Math.round(m.kcal)} kcal · P${Math.round(m.protein_g)} C${Math.round(m.carbs_g)} G${Math.round(m.fat_g)}`,
          details: { meal: m },
        }
      }
    }
  }

  private async supplementFromPreset(presetKey: string | undefined, name: string, dose?: number): Promise<string> {
    const preset = SUPPLEMENT_PRESETS.find((p) => p.key === presetKey) ?? findPreset(name)
    const existing = must(await this.db.select("supplements", "id, name").eq("archived", false), "supplements") as unknown as { id: string; name: string }[]
    const match = existing.find((s) => s.name.toLowerCase() === (preset?.name ?? name).toLowerCase())
    if (match) return match.id
    const { data } = await supabaseAdmin()
      .from("supplements")
      .insert({
        user_id: this.userId, name: preset?.name ?? name, dose: dose ?? preset?.dose ?? 1, unit: preset?.unit ?? "caps",
        slot: preset?.slot ?? "any", with_food: preset?.withFood ?? false, nutrients: preset?.nutrients ?? null,
      })
      .select("id")
      .single()
    return data!.id
  }

  // ---------- tasks ----------

  private async projectId(name?: string): Promise<string | null> {
    if (!name) return null
    const rows = must(await this.db.select("projects", "id, name"), "projects") as unknown as { id: string; name: string }[]
    const found = rows.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (found) return found.id
    const { data } = await supabaseAdmin().from("projects").insert({ user_id: this.userId, name, position: rows.length }).select("id").single()
    return data?.id ?? null
  }

  async addTask(input: Parameters<TiloApi["addTask"]>[0]): Promise<Task> {
    if (!input.title?.trim()) throw new BadRequestError("title is required")
    const { data, error } = await supabaseAdmin()
      .from("tasks")
      .insert({
        user_id: this.userId, title: input.title.trim().slice(0, 300), notes: input.notes ?? null,
        due_date: input.due_date ?? null, priority: input.priority ?? "medium", project_id: await this.projectId(input.project),
        source: input.source ?? "manual", source_ref: input.source_ref ?? null,
      })
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    return data as Task
  }

  async updateTask(id: string, patch: Parameters<TiloApi["updateTask"]>[1], date: string): Promise<Task> {
    const update: Record<string, unknown> = {}
    for (const k of ["title", "notes", "priority", "due_date", "project_id"] as const) if (k in patch) update[k] = patch[k]
    if (patch.status) {
      update.status = patch.status
      update.completed_on = patch.status === "done" ? date : null
    }
    const { data, error } = await this.db.update("tasks", update).eq("id", id).select("*").maybeSingle()
    if (error) throw new BadRequestError(error.message)
    if (!data) throw new NotFoundError("Task not found")
    return data as Task
  }

  // ---------- checklist ----------

  private async owns(table: string, id: string) {
    const { data } = await this.db.select(table, "id").eq("id", id).maybeSingle()
    if (!data) throw new NotFoundError(`${table} not found`)
  }

  async setHabit(id: string, done: boolean, date: string) {
    await this.owns("habits", id)
    if (done) must(await this.db.upsert("habit_logs", { habit_id: id, date, source: "manual" }, "habit_id,date"), "habit log")
    else must(await this.db.delete("habit_logs").eq("habit_id", id).eq("date", date), "habit log")
    return { ok: true as const }
  }

  async setSupplement(id: string, taken: boolean, date: string) {
    await this.owns("supplements", id)
    if (taken) {
      const { error } = await this.db.insert("supplement_logs", { supplement_id: id, date })
      if (error && !/duplicate key/.test(error.message)) throw new Error(error.message)
    } else {
      must(await this.db.delete("supplement_logs").eq("supplement_id", id).eq("date", date), "supplement log")
    }
    return { ok: true as const }
  }

  // ---------- body & nutrition ----------

  async addWater(ml: number, date: string) {
    if (!(ml > 0 && ml <= 5000)) throw new BadRequestError("ml must be between 1 and 5000")
    must(await this.db.insert("water_logs", { date, ml: Math.round(ml) }), "water")
    const [logs, goals] = await Promise.all([
      this.db.select("water_logs", "ml").eq("date", date),
      supabaseAdmin().from("goals").select("water_ml").eq("user_id", this.userId).single(),
    ])
    return {
      total: ((logs.data ?? []) as unknown as { ml: number }[]).reduce((s, r) => s + r.ml, 0),
      target: (goals.data?.water_ml as number) ?? 2500,
    }
  }

  async addMeal(meal: NewMeal): Promise<Meal> {
    if (!meal.description?.trim()) throw new BadRequestError("description is required")
    const date = meal.date!
    const hasMacros = meal.kcal != null
    const est = hasMacros ? null : await estimateMeal(this.userId, meal.description, meal.eaten_at)
    const { data, error } = await supabaseAdmin()
      .from("meals")
      .insert({
        user_id: this.userId, date, description: meal.description.trim().slice(0, 500),
        eaten_at: meal.eaten_at ?? null,
        meal_type: meal.meal_type ?? est?.meal_type ?? null,
        kcal: meal.kcal ?? est!.kcal, protein_g: meal.protein_g ?? est?.protein_g ?? 0, carbs_g: meal.carbs_g ?? est?.carbs_g ?? 0,
        fat_g: meal.fat_g ?? est?.fat_g ?? 0, fiber_g: meal.fiber_g ?? est?.fiber_g ?? 0,
        alcohol_g: est?.alcohol_g ?? 0, caffeine_mg: est?.caffeine_mg ?? 0,
        items: est?.items ?? null, micros: est ? { ...est.micros, ...(est.assumptions ? { _assumptions: est.assumptions } : {}) } : null,
        source: hasMacros ? "mcp" : "ai",
      })
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    return data as Meal
  }

  async addWeight(kg: number, bodyFatPct: number | undefined, date: string) {
    if (!(kg >= 20 && kg <= 400)) throw new BadRequestError("kg must be between 20 and 400")
    must(await this.db.insert("weight_logs", { date, kg, body_fat_pct: bodyFatPct ?? null, source: "manual" }), "weight")
    return { ok: true as const }
  }

  // ---------- training ----------

  private async openWorkout(date: string): Promise<{ id: string }> {
    const { data } = await this.db.select("workouts", "id").eq("date", date).is("ended_at", null).order("started_at", { ascending: false }).limit(1)
    const open = (data as unknown as { id: string }[] | null)?.[0]
    return open ?? this.startWorkout({ date })
  }

  async startWorkout(input: { name?: string; routine_id?: string; date?: string }): Promise<Workout> {
    let name = input.name
    if (input.routine_id) {
      const { data } = await this.db.select("routines", "name").eq("id", input.routine_id).maybeSingle()
      if (!data) throw new NotFoundError("Routine not found")
      name ??= (data as unknown as { name: string }).name
    }
    const { data, error } = await supabaseAdmin()
      .from("workouts")
      .insert({ user_id: this.userId, date: input.date, routine_id: input.routine_id ?? null, name: name ?? "Entrenamiento" })
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    return { ...(data as Workout), sets: [] }
  }

  async resolveExercise(set: NewSet): Promise<{ id: string; name: string }> {
    const admin = supabaseAdmin()
    if (set.exercise_id) {
      const { data } = await admin.from("exercises").select("id, name, name_es, user_id").eq("id", set.exercise_id).maybeSingle()
      if (!data || (data.user_id && data.user_id !== this.userId)) throw new NotFoundError("Exercise not found")
      return { id: data.id, name: data.name_es ?? data.name }
    }
    const name = set.exercise_name?.trim()
    if (!name) throw new BadRequestError("exercise_id or exercise_name is required")
    const known = findExercise(name)
    if (known) {
      const { data } = await admin.from("exercises").select("id").is("user_id", null).eq("slug", known.slug).maybeSingle()
      if (data) return { id: data.id, name: known.name_es }
    }
    const slug = slugify(name)
    const { data: own } = await admin.from("exercises").select("id, name").eq("user_id", this.userId).eq("slug", slug).maybeSingle()
    if (own) return { id: own.id, name: own.name }
    const { data, error } = await admin
      .from("exercises")
      .insert({ user_id: this.userId, slug, name, name_es: name, primary_muscle: "full_body", kind: "strength" })
      .select("id")
      .single()
    if (error) throw new Error(error.message)
    return { id: data.id, name }
  }

  async addSet(workoutId: string, set: NewSet) {
    await this.owns("workouts", workoutId)
    const ex = await this.resolveExercise(set)
    const existing = (must(await this.db.select("workout_sets", "exercise_id, position, set_no").eq("workout_id", workoutId), "sets") ??
      []) as unknown as { exercise_id: string; position: number; set_no: number }[]
    const sameExercise = existing.filter((s) => s.exercise_id === ex.id)
    const position = sameExercise[0]?.position ?? existing.reduce((m, s) => Math.max(m, s.position + 1), 0)

    // Previous bests for this exercise, before this workout
    const history = ((await this.db.select("workout_sets", "workout_id, weight_kg, reps, is_warmup").eq("exercise_id", ex.id).neq("workout_id", workoutId)).data ??
      []) as unknown as { workout_id: string; weight_kg: number | null; reps: number | null; is_warmup: boolean }[]
    const work = history.filter((s) => !s.is_warmup && s.weight_kg != null && s.reps != null).map((s) => ({ weightKg: Number(s.weight_kg), reps: s.reps! }))
    const byWorkout = new Map<string, { weightKg: number; reps: number }[]>()
    for (const s of history.filter((h) => !h.is_warmup && h.weight_kg != null && h.reps != null)) {
      byWorkout.set(s.workout_id, [...(byWorkout.get(s.workout_id) ?? []), { weightKg: Number(s.weight_kg), reps: s.reps! }])
    }
    const previous = work.length
      ? {
          e1rm: bestSet(work)?.e1rm ?? 0,
          maxWeight: Math.max(...work.map((s) => s.weightKg)),
          maxVolume: Math.max(...[...byWorkout.values()].map((v) => volume(v))),
        }
      : null

    const { data, error } = await supabaseAdmin()
      .from("workout_sets")
      .insert({
        workout_id: workoutId, user_id: this.userId, exercise_id: ex.id, position, set_no: sameExercise.length + 1,
        weight_kg: set.weight_kg ?? null, reps: set.reps ?? null, rpe: set.rpe ?? null, is_warmup: set.is_warmup ?? false,
        duration_s: set.duration_s ?? null, distance_m: set.distance_m ?? null,
      })
      .select("*")
      .single()
    if (error) throw new Error(error.message)

    const thisSet = set.is_warmup || set.weight_kg == null || set.reps == null ? null : { weightKg: set.weight_kg, reps: set.reps }
    const rec = thisSet && previous ? checkRecords([thisSet], previous) : null
    return {
      ...(data as WorkoutSet),
      exercise_name: ex.name,
      records: rec ? { e1rm: rec.e1rm && (e1rm(thisSet!.weightKg, thisSet!.reps) ?? 0) > 0, weight: rec.weight } : undefined,
    }
  }

  async finishWorkout(workoutId: string, notes?: string): Promise<Workout> {
    await this.owns("workouts", workoutId)
    const { data: w } = await this.db.select("workouts", "*").eq("id", workoutId).single()
    const workout = w as unknown as Workout
    const ended = workout.ended_at ?? new Date().toISOString()
    // Link the watch recording of the same session so it isn't counted twice
    const { data: acts } = await this.db
      .select("activities", "id, type, start_at, end_at")
      .eq("date", workout.date)
      .is("merged_into", null)
      .lte("start_at", ended)
      .gte("end_at", workout.started_at)
    const match = ((acts ?? []) as unknown as { id: string; type: string }[]).find((a) => ["strength", "hiit", "other"].includes(a.type))
    const { data, error } = await this.db
      .update("workouts", { ended_at: ended, notes: notes ?? workout.notes, activity_id: match?.id ?? workout.activity_id })
      .eq("id", workoutId)
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    const sets = (await this.db.select("workout_sets", "*").eq("workout_id", workoutId).order("position").order("set_no")).data ?? []
    return { ...(data as unknown as Workout), sets: sets as unknown as WorkoutSet[] }
  }

  // ---------- productivity ----------

  async addCheckin(input: { energy?: number; mood?: number; note?: string; date?: string }): Promise<Checkin> {
    const { data, error } = await supabaseAdmin()
      .from("checkins")
      .insert({ user_id: this.userId, date: input.date, energy: input.energy ?? null, mood: input.mood ?? null, note: input.note ?? null })
      .select("*")
      .single()
    if (error) throw new BadRequestError(error.message)
    return data as Checkin
  }

  async startFocus(input: Parameters<TiloApi["startFocus"]>[0]) {
    if (input.task_id) await this.owns("tasks", input.task_id)
    const { data, error } = await supabaseAdmin()
      .from("focus_sessions")
      .insert({
        user_id: this.userId, task_id: input.task_id ?? null, date: input.date, started_at: new Date().toISOString(),
        planned_min: input.planned_min ?? 25, kind: input.kind ?? "focus", source: input.source ?? "web",
      })
      .select("id")
      .single()
    if (error) throw new BadRequestError(error.message)
    return { id: data.id as string }
  }

  async stopFocus(id: string) {
    const { data, error } = await this.db
      .update("focus_sessions", { ended_at: new Date().toISOString() })
      .eq("id", id)
      .is("ended_at", null)
      .select("started_at, ended_at")
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new NotFoundError("Focus session not found or already stopped")
    const d = data as unknown as { started_at: string; ended_at: string }
    return { minutes: Math.round((Date.parse(d.ended_at) - Date.parse(d.started_at)) / 60_000) }
  }
}

