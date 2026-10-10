// Daily energy expenditure, term by term, with traceable inputs.
// total = (BMR + NEAT + exercise + TEF) × calibration
//
// BMR       Katch-McArdle when body fat is known, else Mifflin-St Jeor, on the 7-day weight trend
// NEAT      measured active energy minus exercise, or steps → distance → 0.5 kcal/kg/km,
//           excluding steps already inside workouts, plus a small non-walking baseline
// exercise  per session: device kcal (net) > heart-rate (Keytel) > MET × kg × hours, + EPOC for strength/HIIT
// TEF       25% protein, 8% carbs, 3% fat, 20% alcohol of logged kcal
// calibration  adaptive factor from intake vs. weight trend over the last weeks

export type Sex = "male" | "female"

export interface EnergyProfile {
  sex: Sex | null
  ageYears: number | null
  heightCm: number | null
  bodyFatPct: number | null
  activityLevel: number // used only when there is no movement data at all
}

export interface ExerciseSession {
  id: string
  type: string // run, ride, swim, walk, hike, strength, hiit, tennis, yoga, other
  durationS: number
  kcal?: number | null // as reported by the device / service
  kcalIsNet?: boolean // Apple Health "active energy" is net; Strava/Garmin calories are gross
  avgHr?: number | null
  steps?: number | null
  distanceM?: number | null
  met?: number | null // for manual sessions (exercise library MET)
  avgRpe?: number | null // strength sessions
  coveredByActiveEnergy?: boolean // the watch measuring active energy also recorded this session
}

export interface DayEnergyInput {
  date: string
  weightKg: number // trend weight
  steps?: number | null
  activeKcal?: number | null // measured active energy (net), e.g. Apple Watch
  sessions: ExerciseSession[]
  intake?: { proteinG: number; carbsG: number; fatG: number; alcoholG?: number; kcal: number } | null
  calibration?: number
}

export interface EnergyTerm {
  kcal: number
  method: string
}

export interface DayEnergy {
  date: string
  bmr: EnergyTerm
  neat: EnergyTerm
  exercise: EnergyTerm & { sessions: { id: string; kcal: number; method: string }[] }
  tef: EnergyTerm
  calibration: number
  total: number // calibrated
  intake: number
  balance: number // intake − total
  confidence: "high" | "medium" | "low"
}

const NET_WALK_KCAL_PER_KG_KM = 0.5
const NON_WALKING_BASELINE = 0.08 // fidgeting, standing, chores: share of BMR
const STRIDE_FACTOR = 0.415 // stride ≈ 41.5% of height
const EPOC_SHARE: Record<string, number> = { strength: 0.06, hiit: 0.12 }
const STEP_TYPES = new Set(["run", "walk", "hike"])

export function ageFrom(birthDate: string | null | undefined, onDate: string): number | null {
  if (!birthDate) return null
  const [by, bm, bd] = birthDate.split("-").map(Number)
  const [y, m, d] = onDate.split("-").map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

export function bmr(profile: EnergyProfile, weightKg: number): EnergyTerm {
  if (profile.bodyFatPct != null) {
    const lbm = weightKg * (1 - profile.bodyFatPct / 100)
    return { kcal: 370 + 21.6 * lbm, method: `Katch-McArdle · ${weightKg.toFixed(1)} kg · ${profile.bodyFatPct}% grasa` }
  }
  const height = profile.heightCm ?? (profile.sex === "female" ? 163 : 176)
  const age = profile.ageYears ?? 35
  const sexTerm = profile.sex === "female" ? -161 : profile.sex === "male" ? 5 : -78
  const missing = [profile.heightCm == null && "altura", profile.ageYears == null && "edad", profile.sex == null && "sexo"].filter(Boolean)
  return {
    kcal: 10 * weightKg + 6.25 * height - 5 * age + sexTerm,
    method: `Mifflin-St Jeor · ${weightKg.toFixed(1)} kg` + (missing.length ? ` (estimado: falta ${missing.join(", ")})` : ""),
  }
}

// Gross kcal/min from heart rate (Keytel et al. 2005)
export function keytelKcalPerMin(sex: Sex | null, hr: number, kg: number, age: number): number {
  const male = (-55.0969 + 0.6309 * hr + 0.1988 * kg + 0.2017 * age) / 4.184
  const female = (-20.4022 + 0.4472 * hr - 0.1263 * kg + 0.074 * age) / 4.184
  return Math.max(0, sex === "female" ? female : sex === "male" ? male : (male + female) / 2)
}

const DEFAULT_MET: Record<string, number> = {
  run: 9.8, ride: 7.5, swim: 8.3, walk: 3.8, hike: 6, strength: 5, hiit: 8, tennis: 7.3, padel: 6,
  football: 7, yoga: 2.5, rowing: 7, elliptical: 5, other: 5,
}

function strengthMet(avgRpe: number | null | undefined): number {
  if (avgRpe == null) return 5
  return avgRpe >= 8.5 ? 6 : avgRpe >= 7 ? 5.5 : 4.5
}

export function sessionKcal(s: ExerciseSession, profile: EnergyProfile, weightKg: number, bmrPerMin: number): { kcal: number; method: string } {
  const minutes = s.durationS / 60
  const epoc = 1 + (EPOC_SHARE[s.type] ?? 0)
  if (s.kcal != null && s.kcal > 0) {
    const net = s.kcalIsNet ? s.kcal : Math.max(0, s.kcal - bmrPerMin * minutes)
    return { kcal: net * epoc, method: s.kcalIsNet ? "kcal del dispositivo" : "kcal del dispositivo (sin basal)" }
  }
  if (s.avgHr != null && s.avgHr >= 90 && profile.ageYears != null) {
    const gross = keytelKcalPerMin(profile.sex, s.avgHr, weightKg, profile.ageYears) * minutes
    return { kcal: Math.max(0, gross - bmrPerMin * minutes) * epoc, method: `frecuencia cardíaca (${s.avgHr} lpm)` }
  }
  const met = s.met ?? (s.type === "strength" ? strengthMet(s.avgRpe) : DEFAULT_MET[s.type] ?? DEFAULT_MET.other)
  return { kcal: Math.max(0, met - 1) * weightKg * (minutes / 60) * epoc, method: `MET ${met}` }
}

export function strideM(heightCm: number | null): number {
  return ((heightCm ?? 172) / 100) * STRIDE_FACTOR
}

export function tef(intake: DayEnergyInput["intake"]): EnergyTerm | null {
  if (!intake || intake.kcal <= 0) return null
  const kcal = intake.proteinG * 4 * 0.25 + intake.carbsG * 4 * 0.08 + intake.fatG * 9 * 0.03 + (intake.alcoholG ?? 0) * 7 * 0.2
  return { kcal, method: "25% proteína · 8% carbos · 3% grasas" }
}

export function computeDayEnergy(profile: EnergyProfile, input: DayEnergyInput): DayEnergy {
  const base = bmr(profile, input.weightKg)
  const bmrPerMin = base.kcal / 1440

  // Exercise
  const sessions = input.sessions.map((s) => ({ s, ...sessionKcal(s, profile, input.weightKg, bmrPerMin) }))
  const exerciseKcal = sessions.reduce((sum, x) => sum + x.kcal, 0)

  // NEAT
  let neat: EnergyTerm
  let movementData: "measured" | "steps" | "none"
  if (input.activeKcal != null && input.activeKcal > 0) {
    // Active energy already includes sessions the same watch recorded
    const inside = sessions.filter((x) => x.s.coveredByActiveEnergy).reduce((sum, x) => sum + x.kcal, 0)
    neat = { kcal: Math.max(0, input.activeKcal - inside), method: "energía activa medida, sin los entrenamientos" }
    movementData = "measured"
  } else if (input.steps != null && input.steps > 0) {
    const stride = strideM(profile.heightCm)
    const stepsInSessions = input.sessions
      .filter((s) => STEP_TYPES.has(s.type))
      .reduce((sum, s) => sum + (s.steps ?? (s.distanceM ? s.distanceM / stride : 0)), 0)
    const walkingSteps = Math.max(0, input.steps - stepsInSessions)
    const km = (walkingSteps * stride) / 1000
    neat = {
      kcal: km * NET_WALK_KCAL_PER_KG_KM * input.weightKg + base.kcal * NON_WALKING_BASELINE,
      method: `${Math.round(walkingSteps).toLocaleString("en-US")} pasos fuera de entrenamientos · ${km.toFixed(1)} km`,
    }
    movementData = "steps"
  } else {
    neat = { kcal: base.kcal * Math.max(0, profile.activityLevel - 1.1), method: `nivel de actividad ×${profile.activityLevel} (sin datos de movimiento)` }
    movementData = "none"
  }

  const preTef = base.kcal + neat.kcal + exerciseKcal
  const tefTerm = tef(input.intake) ?? { kcal: preTef * 0.075, method: "estimado (sin comidas registradas)" }
  const calibration = input.calibration ?? 1
  // Total is built from the rounded terms so the breakdown always adds up on screen
  const total = (Math.round(base.kcal) + Math.round(neat.kcal) + Math.round(exerciseKcal) + Math.round(tefTerm.kcal)) * calibration
  const intake = input.intake?.kcal ?? 0

  const confidence: DayEnergy["confidence"] =
    movementData === "measured" && input.intake ? "high" : movementData !== "none" && input.intake ? "medium" : "low"

  const round = (t: EnergyTerm) => ({ ...t, kcal: Math.round(t.kcal) })
  return {
    date: input.date,
    bmr: round(base),
    neat: round(neat),
    exercise: {
      kcal: Math.round(exerciseKcal),
      method: sessions.length ? `${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"}` : "sin entrenamientos",
      sessions: sessions.map((x) => ({ id: x.s.id, kcal: Math.round(x.kcal), method: x.method })),
    },
    tef: round(tefTerm),
    calibration,
    total: Math.round(total),
    intake: Math.round(intake),
    balance: Math.round(intake - total),
    confidence,
  }
}

// ---------- weight trend and adaptive calibration ----------

const KCAL_PER_KG = 7700
const TREND_ALPHA = 0.1

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

// Exponentially smoothed weight per day (Hacker's Diet style); gaps keep the last trend
export function weightTrend(weights: { date: string; kg: number }[], from: string, to: string): Map<string, number> {
  const byDate = new Map<string, number>()
  for (const w of [...weights].sort((a, b) => a.date.localeCompare(b.date))) byDate.set(w.date, w.kg)
  const out = new Map<string, number>()
  const first = [...byDate.entries()].find(([d]) => d >= from) ?? [...byDate.entries()].at(-1)
  const before = [...byDate.entries()].filter(([d]) => d < from).at(-1)
  let trend = before?.[1] ?? first?.[1]
  if (trend == null) return out
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = byDate.get(d)
    if (w != null) trend = trend + TREND_ALPHA * (w - trend)
    out.set(d, Math.round(trend * 100) / 100)
  }
  return out
}

export interface CalibrationDay {
  date: string
  intakeKcal: number | null // null = not logged
  modelKcal: number // uncalibrated total
}

// Compares what the model says you burned with what intake and the weight trend imply
export function adaptiveCalibration(
  days: CalibrationDay[],
  weights: { date: string; kg: number }[],
  previous = 1,
): { factor: number; observedTdee: number | null; loggedDays: number; reason: string } {
  const logged = days.filter((d) => d.intakeKcal != null && d.intakeKcal > 400)
  if (days.length < 14 || logged.length < days.length * 0.7) {
    return { factor: previous, observedTdee: null, loggedDays: logged.length, reason: "faltan comidas registradas (70% de los días)" }
  }
  const from = days[0].date
  const to = days.at(-1)!.date
  const inRange = weights.filter((w) => w.date >= addDays(from, -14) && w.date <= to)
  if (inRange.filter((w) => w.date >= from).length < 4) {
    return { factor: previous, observedTdee: null, loggedDays: logged.length, reason: "faltan pesajes (mínimo 4)" }
  }
  const trend = weightTrend(inRange, addDays(from, -1), to)
  const start = trend.get(addDays(from, -1))!
  const end = trend.get(to)!
  const avgIntake = logged.reduce((s, d) => s + d.intakeKcal!, 0) / logged.length
  const observedTdee = avgIntake - ((end - start) * KCAL_PER_KG) / days.length
  const avgModel = days.reduce((s, d) => s + d.modelKcal, 0) / days.length
  const raw = Math.min(1.15, Math.max(0.85, observedTdee / avgModel))
  const factor = Math.round((previous * 0.5 + raw * 0.5) * 1000) / 1000
  return {
    factor,
    observedTdee: Math.round(observedTdee),
    loggedDays: logged.length,
    reason: `${days.length} días · peso ${start.toFixed(1)} → ${end.toFixed(1)} kg`,
  }
}
