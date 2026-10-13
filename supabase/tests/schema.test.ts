import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { asAnon, asService, asUser, createDb, createUser } from "./db"

const ALICE = "00000000-0000-4000-8000-00000000000a"
const BOB = "00000000-0000-4000-8000-00000000000b"
const DAY = "2026-10-08" // Thursday (weekday index 3)

let db: PGlite

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params)
  return res.rows[0]
}

beforeAll(async () => {
  db = await createDb()
  await createUser(db, ALICE, "alice@example.com", "Alice")
  await createUser(db, BOB, "bob@example.com", "Bob")
}, 60_000)

describe("new user bootstrap", () => {
  it("creates profile, goals, settings and default projects", async () => {
    await asUser(db, ALICE)
    const p = await one<{ name: string; plan: string }>("select name, plan from profiles")
    expect(p).toMatchObject({ name: "Alice", plan: "trial" })
    expect((await one<{ kcal: number }>("select kcal from goals")).kcal).toBe(2200)
    expect((await db.query("select name from projects order by position")).rows.map((r: any) => r.name)).toEqual(["Personal", "Work"])
  })

  it("seeds the global exercise library, readable by users", async () => {
    await asUser(db, ALICE)
    const { n } = await one<{ n: number }>("select count(*)::int as n from exercises where user_id is null")
    expect(n).toBeGreaterThan(100)
  })
})

describe("row level security", () => {
  it("keeps each user's rows private", async () => {
    await asUser(db, ALICE)
    await db.query("insert into water_logs (user_id, date, ml) values ($1, $2, 500)", [ALICE, DAY])
    await asUser(db, BOB)
    expect((await db.query("select * from water_logs")).rows).toHaveLength(0)
    expect((await db.query("select * from profiles")).rows).toHaveLength(1)
  })

  it("rejects writing rows for someone else", async () => {
    await asUser(db, BOB)
    await expect(db.query("insert into water_logs (user_id, date, ml) values ($1, $2, 250)", [ALICE, DAY])).rejects.toThrow()
  })

  it("does not let users change their billing plan", async () => {
    await asUser(db, ALICE)
    await expect(db.query("update profiles set plan = 'pro'")).rejects.toThrow()
    await db.query("update profiles set height_cm = 178") // other columns are fine
  })

  it("hides OAuth secrets from users and anonymous callers", async () => {
    await asService(db)
    await db.query("insert into connections (user_id, provider, external_id) values ($1, 'strava', '42')", [ALICE])
    await db.query(
      "insert into connection_secrets (user_id, provider, external_id, access_token) values ($1, 'strava', '42', 'enc:secret')",
      [ALICE],
    )
    await asUser(db, ALICE)
    expect((await db.query("select provider from connections")).rows).toHaveLength(1)
    await expect(db.query("select * from connection_secrets")).rejects.toThrow()
    await asAnon(db)
    await expect(db.query("select * from connection_secrets")).rejects.toThrow()
    expect((await db.query("select * from water_logs")).rows).toHaveLength(0)
  })

  it("does not let anonymous callers run the RPCs", async () => {
    await asAnon(db)
    await expect(db.query("select get_day($1)", [DAY])).rejects.toThrow()
  })
})

describe("daily summary triggers", () => {
  it("rolls up water, meals, tasks, habits, supplements and sets", async () => {
    await asUser(db, ALICE)
    await db.query("insert into water_logs (user_id, date, ml) values ($1, $2, 250)", [ALICE, DAY])
    await db.query(
      "insert into meals (user_id, date, description, kcal, protein_g, carbs_g, fat_g) values ($1, $2, 'Pollo y arroz', 690, 52, 68, 18), ($1, $2, 'Whey', 120, 24, 3, 1)",
      [ALICE, DAY],
    )
    await db.query("insert into tasks (user_id, title, status, completed_on) values ($1, 'Deploy', 'done', $2)", [ALICE, DAY])
    const habit = await one<{ id: string }>("insert into habits (user_id, name) values ($1, 'Meditar') returning id", [ALICE])
    await db.query("insert into habit_logs (habit_id, user_id, date) values ($1, $2, $3)", [habit.id, ALICE, DAY])
    const supp = await one<{ id: string }>(
      "insert into supplements (user_id, name, dose, unit, stock_doses) values ($1, 'D3', 2000, 'iu', 30) returning id",
      [ALICE],
    )
    await db.query("insert into supplement_logs (supplement_id, user_id, date) values ($1, $2, $3)", [supp.id, ALICE, DAY])

    const bench = await one<{ id: string }>("select id from exercises where slug = 'bench-press'")
    const w = await one<{ id: string }>(
      "insert into workouts (user_id, date, name, started_at, ended_at) values ($1, $2, 'Push A', now() - interval '50 minutes', now()) returning id",
      [ALICE, DAY],
    )
    await db.query(
      "insert into workout_sets (workout_id, user_id, exercise_id, set_no, weight_kg, reps) values ($1, $2, $3, 1, 80, 8), ($1, $2, $3, 2, 80, 7), ($1, $2, $3, 0, 40, 10)",
      [w.id, ALICE, bench.id],
    )
    await db.query("update workout_sets set is_warmup = true where set_no = 0")

    const s = await one<any>("select * from daily_summary where date = $1", [DAY])
    expect(s.water_ml).toBe(750)
    expect(Number(s.kcal_in)).toBe(810)
    expect(Number(s.protein_g)).toBe(76)
    expect(s.meals_count).toBe(2)
    expect(s.tasks_done).toBe(1)
    expect(s.habits_done).toBe(1)
    expect(s.supplements_done).toBe(1)
    expect(s.workouts).toBe(1)
    expect(s.sets_done).toBe(2)
    expect(Number(s.volume_kg)).toBe(80 * 8 + 80 * 7)
    expect(s.sport_min).toBe(50)

    expect((await one<{ stock_doses: number }>("select stock_doses from supplements where id = $1", [supp.id])).stock_doses).toBe(29)
  })

  it("moves the summary when a row changes date and when it is deleted", async () => {
    await asUser(db, ALICE)
    const meal = await one<{ id: string }>(
      "insert into meals (user_id, date, description, kcal) values ($1, '2026-10-07', 'Snack', 200) returning id",
      [ALICE],
    )
    await db.query("update meals set date = '2026-10-06' where id = $1", [meal.id])
    expect(Number((await one<any>("select kcal_in from daily_summary where date = '2026-10-07'")).kcal_in)).toBe(0)
    expect(Number((await one<any>("select kcal_in from daily_summary where date = '2026-10-06'")).kcal_in)).toBe(200)
    await db.query("delete from meals where id = $1", [meal.id])
    expect(Number((await one<any>("select kcal_in from daily_summary where date = '2026-10-06'")).kcal_in)).toBe(0)
  })
})

describe("activities", () => {
  it("auto-completes habits from matching activities", async () => {
    await asUser(db, ALICE)
    const run = await one<{ id: string }>(
      `insert into habits (user_id, name, auto_rule) values ($1, 'Correr', '{"activity_types": ["run"], "min_minutes": 20}') returning id`,
      [ALICE],
    )
    await db.query(
      `insert into activities (user_id, source, external_id, type, date, start_at, end_at, duration_s)
       values ($1, 'strava', 'a1', 'run', $2, '2026-10-08T10:10:00Z', '2026-10-08T10:44:00Z', 2040)`,
      [ALICE, DAY],
    )
    const done = await db.query("select source from habit_logs where habit_id = $1 and date = $2", [run.id, DAY])
    expect(done.rows).toEqual([{ source: "auto" }])
  })
})

describe("RPCs", () => {
  it("get_day returns everything for the Today screen in one call", async () => {
    await asUser(db, ALICE)
    const { get_day: day } = await one<{ get_day: any }>("select get_day($1)", [DAY])
    expect(day.profile.name).toBe("Alice")
    expect(day.goals.kcal).toBe(2200)
    expect(day.meals).toHaveLength(2)
    expect(day.water.map((w: any) => w.ml)).toEqual([500, 250])
    expect(day.habits.find((h: any) => h.name === "Correr")).toMatchObject({ done: true, auto: true })
    expect(day.supplements[0]).toMatchObject({ name: "D3", taken: true })
    expect(day.workouts[0].sets).toHaveLength(3)
    expect(day.workouts[0].sets[0].exercise_name).toBe("Press banca")
    expect(day.activities).toHaveLength(1)
    expect(day.summary.water_ml).toBe(750)
  })

  it("get_day only shows supplements scheduled for that weekday", async () => {
    await asUser(db, ALICE)
    await db.query("insert into supplements (user_id, name, dose, unit, days) values ($1, 'Creatina', 5, 'g', '{6}')", [ALICE])
    const { get_day: day } = await one<{ get_day: any }>("select get_day($1)", [DAY]) // a Thursday
    expect(day.supplements.map((s: any) => s.name)).not.toContain("Creatina")
  })

  it("get_day only shows habits scheduled for that weekday, unless already logged", async () => {
    await asUser(db, ALICE)
    const sunday = await one<{ id: string }>("insert into habits (user_id, name, frequency, per_week, days) values ($1, 'Ir a misa', 'weekly', 1, '{6}') returning id", [ALICE])
    await db.query("insert into habits (user_id, name, days) values ($1, 'Nadar', '{0,1,2,3,4,5}')", [ALICE])
    let { get_day: day } = await one<{ get_day: any }>("select get_day($1)", [DAY]) // a Thursday
    const names = day.habits.map((h: any) => h.name)
    expect(names).toContain("Nadar")
    expect(names).not.toContain("Ir a misa")
    expect(day.habits.find((h: any) => h.name === "Nadar").days).toEqual([0, 1, 2, 3, 4, 5])
    await db.query("insert into habit_logs (habit_id, user_id, date) values ($1, $2, $3)", [sunday.id, ALICE, DAY])
    ;({ get_day: day } = await one<{ get_day: any }>("select get_day($1)", [DAY]))
    expect(day.habits.find((h: any) => h.name === "Ir a misa")).toMatchObject({ done: true })
  })

  it("get_day includes today's routine with the last performance per exercise", async () => {
    await asUser(db, ALICE)
    const bench = await one<{ id: string }>("select id from exercises where slug = 'bench-press'")
    const r = await one<{ id: string }>("insert into routines (user_id, name, weekdays) values ($1, 'Push A', '{4}') returning id", [ALICE])
    await db.query("insert into routine_items (routine_id, user_id, exercise_id, sets, reps_min, reps_max) values ($1, $2, $3, 4, 6, 8)", [
      r.id,
      ALICE,
      bench.id,
    ])
    const { get_day: friday } = await one<{ get_day: any }>("select get_day('2026-10-09')")
    expect(friday.routine.name).toBe("Push A")
    expect(friday.routine.items[0].exercise.name).toBe("Press banca")
    expect(friday.routine.items[0].last.map((s: any) => Number(s.weight_kg))).toEqual([80, 80])
  })

  it("get_range returns summaries, habits, muscle volume and best lifts", async () => {
    await asUser(db, ALICE)
    const { get_range: r } = await one<{ get_range: any }>("select get_range('2026-10-01', '2026-10-31')")
    expect(r.summaries.length).toBeGreaterThan(0)
    expect(r.settings).toEqual({})
    expect(r.habits.find((h: any) => h.name === "Meditar").dates).toEqual([DAY])
    expect(r.muscle_sets).toEqual([{ date: DAY, muscle: "chest", sets: 2, volume_kg: 1200 }])
    expect(r.best_lifts[0]).toMatchObject({ name: "Press banca", reps: 8 })
    expect(Number(r.best_lifts[0].e1rm)).toBeCloseTo(101.3, 1)
  })

  it("lets the server act for a user, but not users for each other", async () => {
    await asService(db)
    const { get_day: day } = await one<{ get_day: any }>("select get_day($1, $2)", [DAY, ALICE])
    expect(day.profile.name).toBe("Alice")
    await asUser(db, BOB)
    await expect(db.query("select get_day($1, $2)", [DAY, ALICE])).rejects.toThrow(/another user/)
  })
})
