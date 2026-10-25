import { describe, expect, it } from "vitest"
import { adaptiveCalibration, ageFrom, bmr, computeDayEnergy, keytelKcalPerMin, weightTrend, type EnergyProfile } from "./energy"
import { findExercise } from "./exercises"
import { parseDue, parseQuickAdd, parseSets } from "./quickAdd"
import { dedupeActivities, normaliseActivityType, pickMetrics } from "./sources"
import { electrolyteSuggestion, findPreset } from "./supplements"
import { acwr, checkRecords, e1rm, platesPerSide, suggestNext } from "./training"

const ME: EnergyProfile = { sex: "male", ageYears: 34, heightCm: 178, bodyFatPct: null, activityLevel: 1.375 }
const TODAY = "2026-10-08" // Thursday

describe("energy", () => {
  it("BMR uses Mifflin-St Jeor, or Katch-McArdle when body fat is known", () => {
    expect(Math.round(bmr(ME, 78.6).kcal)).toBe(1734)
    expect(Math.round(bmr({ ...ME, bodyFatPct: 15 }, 78.6).kcal)).toBe(Math.round(370 + 21.6 * 78.6 * 0.85))
    expect(bmr({ ...ME, heightCm: null }, 78.6).method).toMatch(/falta altura/)
  })

  it("computes age from a birth date", () => {
    expect(ageFrom("1992-10-09", TODAY)).toBe(33)
    expect(ageFrom("1992-10-08", TODAY)).toBe(34)
  })

  it("Keytel is in a sensible range for a run", () => {
    const perMin = keytelKcalPerMin("male", 150, 78, 34)
    expect(perMin).toBeGreaterThan(11)
    expect(perMin).toBeLessThan(16)
  })

  it("steps-only day: NEAT excludes steps already inside a run", () => {
    const withRun = computeDayEnergy(ME, {
      date: TODAY,
      weightKg: 78.6,
      steps: 14000,
      sessions: [{ id: "r", type: "run", durationS: 1800, distanceM: 5000, avgHr: 152 }],
      intake: { kcal: 2200, proteinG: 150, carbsG: 230, fatG: 70 },
    })
    const walkOnly = computeDayEnergy(ME, { date: TODAY, weightKg: 78.6, steps: 14000, sessions: [], intake: null })
    expect(withRun.neat.kcal).toBeLessThan(walkOnly.neat.kcal)
    expect(withRun.exercise.sessions[0].method).toMatch(/frecuencia/)
    expect(withRun.exercise.kcal).toBeGreaterThan(250)
    expect(withRun.confidence).toBe("medium")
    expect(withRun.tef.kcal).toBe(Math.round(150 * 4 * 0.25 + 230 * 4 * 0.08 + 70 * 9 * 0.03))
  })

  it("measured active energy: sessions recorded by the same watch are not counted twice", () => {
    const e = computeDayEnergy(ME, {
      date: TODAY,
      weightKg: 78.6,
      activeKcal: 900,
      sessions: [{ id: "w", type: "strength", durationS: 3600, kcal: 320, kcalIsNet: true, coveredByActiveEnergy: true }],
      intake: { kcal: 2400, proteinG: 160, carbsG: 250, fatG: 75 },
    })
    expect(e.exercise.kcal).toBe(Math.round(320 * 1.06))
    expect(e.neat.kcal).toBe(Math.round(900 - 320 * 1.06))
    expect(e.confidence).toBe("high")
    expect(e.total).toBe(e.bmr.kcal + e.neat.kcal + e.exercise.kcal + e.tef.kcal)
  })

  it("gross device calories (Strava) have the basal share removed", () => {
    const e = computeDayEnergy(ME, {
      date: TODAY,
      weightKg: 78.6,
      sessions: [{ id: "s", type: "ride", durationS: 3600, kcal: 700 }],
      intake: null,
    })
    expect(e.exercise.kcal).toBe(Math.round(700 - bmr(ME, 78.6).kcal / 24))
    expect(e.confidence).toBe("low")
  })

  it("applies the calibration factor to the total", () => {
    const base = computeDayEnergy(ME, { date: TODAY, weightKg: 78.6, steps: 8000, sessions: [], intake: null })
    const cal = computeDayEnergy(ME, { date: TODAY, weightKg: 78.6, steps: 8000, sessions: [], intake: null, calibration: 1.05 })
    expect(cal.total).toBe(Math.round((base.bmr.kcal + base.neat.kcal + base.tef.kcal) * 1.05))
  })

  it("weight trend smooths noise", () => {
    const t = weightTrend(
      [{ date: "2026-10-01", kg: 80 }, { date: "2026-10-02", kg: 82 }, { date: "2026-10-03", kg: 79 }],
      "2026-10-01",
      "2026-10-03",
    )
    expect(t.get("2026-10-02")).toBeCloseTo(80.2, 1)
    expect(t.get("2026-10-03")).toBeGreaterThan(79.5)
  })

  it("calibration rises when you eat more than the model says and still lose weight", () => {
    const days = Array.from({ length: 21 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 10 + i)).toISOString().slice(0, 10),
      intakeKcal: 2600,
      modelKcal: 2500,
    }))
    const weights = days.filter((_, i) => i % 3 === 0).map((d, i) => ({ date: d.date, kg: 80 - i * 0.15 }))
    const res = adaptiveCalibration(days, [{ date: "2026-09-01", kg: 80 }, ...weights])
    expect(res.factor).toBeGreaterThan(1)
    expect(res.factor).toBeLessThanOrEqual(1.15)
  })

  it("calibration waits for enough logged days", () => {
    const days = Array.from({ length: 21 }, (_, i) => ({ date: `2026-09-${String(10 + i).padStart(2, "0")}`, intakeKcal: i % 2 ? null : 2000, modelKcal: 2400 }))
    expect(adaptiveCalibration(days, []).reason).toMatch(/comidas/)
  })
})

describe("training", () => {
  it("estimates 1RM with Epley and ignores high-rep sets", () => {
    expect(e1rm(80, 8)).toBeCloseTo(101.3, 1)
    expect(e1rm(100, 1)).toBe(100)
    expect(e1rm(40, 20)).toBeNull()
  })

  it("detects records against previous bests", () => {
    const r = checkRecords([{ weightKg: 82.5, reps: 8 }, { weightKg: 82.5, reps: 7 }], { e1rm: 101.3, maxWeight: 80, maxVolume: 1800 })
    expect(r).toEqual({ e1rm: true, weight: true, volume: false })
  })

  it("suggests progression with double progression", () => {
    const target = { sets: 3, repsMin: 6, repsMax: 8, lowerBody: false }
    expect(suggestNext([{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }], target)?.weightKg).toBe(82.5)
    expect(suggestNext([{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 7 }, { weightKg: 80, reps: 6 }], target)?.weightKg).toBe(80)
    expect(suggestNext([{ weightKg: 80, reps: 5 }, { weightKg: 80, reps: 4 }, { weightKg: 80, reps: 4 }], target)?.weightKg).toBe(72.5)
  })

  it("loads plates per side", () => {
    expect(platesPerSide(82.5)).toEqual({ perSide: [25, 5, 1.25], achievedKg: 82.5 })
    expect(platesPerSide(20).perSide).toEqual([])
  })

  it("computes the acute:chronic workload ratio", () => {
    expect(acwr(Array(28).fill(100))).toBe(1)
    expect(acwr(Array(10).fill(100))).toBeNull()
  })
})

describe("sources", () => {
  it("takes the highest step count and the watch for heart data", () => {
    const { values, sources } = pickMetrics([
      { source: "apple", device: "iPhone", steps: 6200, resting_hr: 60 },
      { source: "health_connect", device: "Mi Band 8", steps: 8432, resting_hr: 54 },
    ])
    expect(values).toMatchObject({ steps: 8432, resting_hr: 54 })
    expect(sources).toMatchObject({ steps: "health_connect", resting_hr: "health_connect" })
  })

  it("respects a pinned source", () => {
    const { sources } = pickMetrics([{ source: "apple", steps: 6000 }, { source: "google_health", steps: 9000 }], undefined, { steps: "apple" })
    expect(sources.steps).toBe("apple")
  })

  it("merges the same run from Strava and Apple Health, keeping the richer one", () => {
    const { mergedInto, fill } = dedupeActivities([
      { id: "apple-1", source: "apple", type: "run", start_at: "2026-10-08T10:10:00Z", end_at: "2026-10-08T10:44:00Z", kcal: 410, steps: 5600 },
      { id: "strava-1", source: "strava", type: "run", start_at: "2026-10-08T10:11:00Z", end_at: "2026-10-08T10:45:00Z", avg_hr: 151, distance_m: 6200 },
      { id: "apple-2", source: "apple", type: "strength", start_at: "2026-10-08T19:00:00Z", end_at: "2026-10-08T20:00:00Z" },
    ])
    expect(mergedInto.get("apple-1")).toBe("strava-1")
    expect(mergedInto.has("apple-2")).toBe(false)
    expect(fill.get("strava-1")).toEqual({ kcal: 410, steps: 5600 })
  })

  it("normalises provider activity types", () => {
    expect(normaliseActivityType("TrailRun")).toBe("run")
    expect(normaliseActivityType("HKWorkoutActivityTypeTraditionalStrengthTraining".replace("HKWorkoutActivityType", ""))).toBe("strength")
    expect(normaliseActivityType("Kitesurf")).toBe("surf")
    expect(normaliseActivityType("Golf")).toBe("golf")
    expect(normaliseActivityType("Underwater basket weaving")).toBe("other")
    expect(normaliseActivityType("Outdoor Run")).toBe("run")
    expect(normaliseActivityType("Traditional Strength Training")).toBe("strength")
    expect(normaliseActivityType("High Intensity Interval Training")).toBe("hiit")
    expect(normaliseActivityType("Outdoor Cycle")).toBe("ride")
    expect(normaliseActivityType("Pool Swim")).toBe("swim")
  })
})

describe("supplements", () => {
  it("finds presets by common names", () => {
    expect(findPreset("d3 2000")?.key).toBe("vitamin_d3")
    expect(findPreset("tomé magnesio")?.key).toBe("magnesium")
    expect(findPreset("b12")?.key).toBe("vitamin_b12")
  })

  it("suggests electrolytes only for long or hard sessions", () => {
    expect(electrolyteSuggestion(30, 130)).toBeNull()
    const s = electrolyteSuggestion(90, 160)
    expect(s?.sodiumMg).toBeGreaterThan(900)
  })
})

describe("quick add", () => {
  const ctx = {
    today: TODAY,
    habits: [{ id: "h1", name: "Meditar 10 min" }, { id: "h2", name: "Leer 20 páginas" }],
    supplements: [{ id: "s1", name: "Omega-3", dose: 1, unit: "g" as const }],
    projects: ["Work", "Personal"],
  }

  it.each([
    ["500 agua", { kind: "water", ml: 500 }],
    ["agua 1.5l", { kind: "water", ml: 1500 }],
    ["2 vasos de agua", { kind: "water", ml: 500 }],
    ["+250", { kind: "water", ml: 250 }],
    ["peso 78,6", { kind: "weight", kg: 78.6 }],
    ["peso 78.6 15%", { kind: "weight", kg: 78.6, bodyFatPct: 15 }],
    ["energia 4 animo 3", { kind: "checkin", energy: 4, mood: 3 }],
    ["cafe doble", { kind: "caffeine", mg: 150, label: "Café doble" }],
    ["2 cafe", { kind: "caffeine", mg: 160, label: "Café" }],
  ])("%s", (input, expected) => {
    expect(parseQuickAdd(input, ctx)).toEqual(expected)
  })

  it("parses strength sets in common notations", () => {
    const r = parseQuickAdd("press banca 80x8x3", ctx)
    expect(r).toMatchObject({ kind: "sets", exercise: { slug: "bench-press" } })
    expect(r?.kind === "sets" && r.sets).toEqual([{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }])
    expect(parseSets("3x8 60kg")).toEqual(Array(3).fill({ weightKg: 60, reps: 8 }))
    expect(parseSets("80 x 8,8,7 @8")).toEqual([{ weightKg: 80, reps: 8, rpe: 8 }, { weightKg: 80, reps: 8, rpe: 8 }, { weightKg: 80, reps: 7, rpe: 8 }])
    expect(parseSets("bw x 12")).toEqual([{ weightKg: 0, reps: 12 }])
    expect(parseQuickAdd("sentadilla 3x5x120", ctx)).toMatchObject({ kind: "sets", exercise: { slug: "back-squat" }, sets: Array(3).fill({ weightKg: 120, reps: 5 }) })
    expect(parseQuickAdd("peso muerto rumano 100x10x3", ctx)).toMatchObject({ exercise: { slug: "romanian-deadlift" } })
  })

  it("parses cardio", () => {
    expect(parseQuickAdd("corrí 5 km en 25 min", ctx)).toMatchObject({ kind: "cardio", exercise: { slug: "running" }, minutes: 25, distanceKm: 5 })
    expect(parseQuickAdd("bici 1h30", ctx)).toMatchObject({ kind: "cardio", exercise: { slug: "cycling" }, minutes: 90 })
  })

  it("parses tasks with due date, priority and project", () => {
    expect(parseQuickAdd("tarea: revisar PR mañana !alta #work", ctx)).toEqual({
      kind: "task", title: "revisar PR", dueDate: "2026-10-09", priority: "high", project: "Work",
    })
    expect(parseQuickAdd("llamar al dentista el viernes", ctx)).toEqual({ kind: "task", title: "llamar al dentista", dueDate: "2026-10-09" })
    expect(parseDue("pagar expensas el 15/10", TODAY).date).toBe("2026-10-15")
    expect(parseDue("algo el lunes", TODAY).date).toBe("2026-10-12")
  })

  it("matches the user's habits and supplements, then presets", () => {
    expect(parseQuickAdd("medite", ctx)).toEqual({ kind: "habit", habitId: "h1", name: "Meditar 10 min" })
    expect(parseQuickAdd("omega-3", ctx)).toMatchObject({ kind: "supplement", supplementId: "s1" })
    expect(parseQuickAdd("D3 2000", ctx)).toMatchObject({ kind: "supplement", presetKey: "vitamin_d3", dose: 2000 })
  })

  it("falls back to a meal for anything else", () => {
    expect(parseQuickAdd("2 empanadas de carne y una coca", ctx)).toEqual({ kind: "meal", description: "2 empanadas de carne y una coca" })
    expect(parseQuickAdd("almuerzo: milanesa con puré", ctx)).toEqual({ kind: "meal", description: "milanesa con puré", mealType: "lunch" })
  })

  it("finds exercises by Spanish aliases", () => {
    expect(findExercise("jalon al pecho")?.slug).toBe("lat-pulldown")
    expect(findExercise("vuelos laterales")?.slug).toBe("lateral-raise")
  })
})

describe("Health Auto Export format", () => {
  it("aggregates metrics per day and converts workouts", async () => {
    const { fromHealthAutoExport } = await import("./ingestFormats")
    const p = fromHealthAutoExport({
      data: {
        metrics: [
          { name: "step_count", units: "count", data: [{ date: "2026-10-08 00:00:00 -0300", qty: 5000, source: "Apple Watch de David|iPhone" }, { date: "2026-10-08 12:00:00 -0300", qty: 3432 }] },
          { name: "active_energy", units: "kJ", data: [{ date: "2026-10-08 00:00:00 -0300", qty: 2092 }] },
          { name: "resting_heart_rate", units: "count/min", data: [{ date: "2026-10-08 00:00:00 -0300", qty: 54 }, { date: "2026-10-08 00:00:00 -0300", qty: 56 }] },
          { name: "sleep_analysis", units: "hr", data: [{ date: "2026-10-08 00:00:00 -0300", asleep: 7.1 }] },
          { name: "weight_body_mass", units: "kg", data: [{ date: "2026-10-08 07:00:00 -0300", qty: 78.6 }] },
          { name: "body_fat_percentage", units: "%", data: [{ date: "2026-10-08 07:00:00 -0300", qty: 0.15 }] },
        ],
        workouts: [
          { name: "Outdoor Run", start: "2026-10-08 07:10:00 -0300", end: "2026-10-08 07:44:00 -0300", activeEnergyBurned: { qty: 410, units: "kcal" }, distance: { qty: 6.2, units: "km" }, avgHeartRate: { qty: 151 } },
        ],
      },
    })
    expect(p.source).toBe("apple")
    expect(p.device).toBe("Apple Watch de David")
    expect(p.daily).toEqual([{ date: "2026-10-08", steps: 8432, active_kcal: 500, resting_hr: 55, sleep_min: 426 }])
    expect(p.weights).toEqual([{ date: "2026-10-08", kg: 78.6, body_fat_pct: 15 }])
    expect(p.activities?.[0]).toMatchObject({ type: "Outdoor Run", start_at: "2026-10-08T07:10:00-03:00", duration_s: 2040, distance_m: 6200, kcal: 410, kcal_is_net: true, avg_hr: 151 })
  })
})

describe("habits completed by activities", () => {
  it("reads the session types from the habit name", async () => {
    const { inferHabitActivityTypes, inferHabitMinMinutes } = await import("./sources")
    expect(inferHabitActivityTypes("Correr")).toEqual(["run"])
    expect(inferHabitActivityTypes("Nadar")).toEqual(["swim"])
    expect(inferHabitActivityTypes("Entrenar fuerza")).toEqual(["strength", "hiit", "other"])
    expect(inferHabitActivityTypes("Jugar al golf")).toEqual(["golf"])
    expect(inferHabitActivityTypes("Leer 20 min")).toBeNull()
    expect(inferHabitMinMinutes("Caminar 30 min")).toBe(30)
  })
})
