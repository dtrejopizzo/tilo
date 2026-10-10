// Parses one line of free text into a typed entry. Rules first (free, instant, offline);
// anything that isn't recognised is a meal, which the AI estimates.
import { EXERCISES, findExercise, type ExerciseDef } from "./exercises"
import { findPreset, type SupplementUnit } from "./supplements"

export type Priority = "low" | "medium" | "high"

export interface SetInput {
  weightKg: number
  reps: number
  rpe?: number
}

export type QuickAddResult =
  | { kind: "water"; ml: number }
  | { kind: "weight"; kg: number; bodyFatPct?: number }
  | { kind: "caffeine"; mg: number; label: string }
  | { kind: "task"; title: string; dueDate?: string; priority?: Priority; project?: string }
  | { kind: "sets"; exercise: ExerciseDef; sets: SetInput[] }
  | { kind: "cardio"; exercise: ExerciseDef; minutes?: number; distanceKm?: number }
  | { kind: "supplement"; name: string; supplementId?: string; presetKey?: string; dose?: number; unit?: SupplementUnit }
  | { kind: "habit"; habitId: string; name: string }
  | { kind: "checkin"; energy?: number; mood?: number }
  | { kind: "meal"; description: string; mealType?: "breakfast" | "lunch" | "dinner" | "snack" }

export interface QuickAddContext {
  today: string // YYYY-MM-DD, user's local date
  habits?: { id: string; name: string }[]
  supplements?: { id: string; name: string; dose: number; unit: SupplementUnit }[]
  projects?: string[]
  glassMl?: number
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()
const num = (s: string) => Number(s.replace(",", "."))

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

const WEEKDAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]
const WEEKDAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

// Spanish/English due dates inside a task line; returns the date and the text without it
export function parseDue(text: string, today: string): { date?: string; rest: string } {
  const t = ` ${text} `
  const rules: [RegExp, (m: RegExpMatchArray) => string | undefined][] = [
    [/\sdue:(\d{4}-\d{2}-\d{2})\s/i, (m) => m[1]],
    [/\s(pasado manana|pasado mañana)\s/i, () => addDays(today, 2)],
    [/\s(hoy|today)\s/i, () => today],
    [/\s(manana|mañana|tomorrow)\s/i, () => addDays(today, 1)],
    [/\sen (\d{1,3}) dias?\s/i, (m) => addDays(today, Number(m[1]))],
    [/\s(?:el )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, (m) => {
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4))
      let d = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
      if (!m[3] && d < today) d = `${year + 1}${d.slice(4)}`
      return d
    }],
    [new RegExp(`\\s(?:el |este |on )?(${[...WEEKDAYS, ...WEEKDAYS_EN, "miércoles", "sábado"].join("|")})\\s`, "i"), (m) => {
      const name = norm(m[1])
      const target = WEEKDAYS.indexOf(name) !== -1 ? WEEKDAYS.indexOf(name) : WEEKDAYS_EN.indexOf(name)
      const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
      return addDays(today, ((target - current + 7) % 7) || 7)
    }],
  ]
  for (const [re, fn] of rules) {
    const m = t.match(re)
    if (m) {
      const date = fn(m)
      if (date) return { date, rest: t.replace(m[0], " ").replace(/\s+/g, " ").trim() }
    }
  }
  return { rest: text.trim() }
}

function parseTask(raw: string, ctx: QuickAddContext): QuickAddResult {
  let text = raw.replace(/^(tarea|task|todo|pendiente)\s*:?\s*/i, "")
  let priority: Priority | undefined
  const pr = text.match(/(^|\s)!(alta|high|urgente|media|medium|baja|low)\b/i)
  if (pr) {
    const p = norm(pr[2])
    priority = p === "alta" || p === "high" || p === "urgente" ? "high" : p === "baja" || p === "low" ? "low" : "medium"
    text = text.replace(pr[0], " ")
  }
  let project: string | undefined
  const pj = text.match(/(^|\s)#([\p{L}\d_-]+)/u)
  if (pj) {
    const wanted = norm(pj[2])
    project = ctx.projects?.find((p) => norm(p) === wanted) ?? pj[2]
    text = text.replace(pj[0], " ")
  }
  const due = parseDue(text, ctx.today)
  return { kind: "task", title: due.rest, dueDate: due.date, priority, project }
}

// "80x8x3", "80 x 8,8,7", "3x8 80kg", "3x10 @ 60", "bw x 12", "100kg 5 reps @9"
export function parseSets(text: string): SetInput[] | null {
  let t = norm(text).replace(/\bbw\b|peso corporal/g, "0").replace(/kgs?/g, " ").replace(/\s*[x×*]\s*/g, "x")
  let rpe: number | undefined
  const r = t.match(/(?:@|rpe ?)(\d+(?:[.,]5)?)\s*$/)
  if (r && num(r[1]) <= 10) {
    rpe = num(r[1])
    t = t.slice(0, r.index).trim()
  }
  const withRpe = (sets: SetInput[]) => sets.map((s) => (rpe != null ? { ...s, rpe } : s))

  // weight x reps,reps,reps
  let m = t.match(/(\d+(?:[.,]\d+)?)x(\d+(?:,\d+)+)/)
  if (m) return withRpe(m[2].split(",").map((reps) => ({ weightKg: num(m![1]), reps: Number(reps) })))

  // a x b x c
  m = t.match(/(\d+(?:[.,]\d+)?)x(\d+)x(\d+(?:[.,]\d+)?)/)
  if (m) {
    const [a, b, c] = [num(m[1]), Number(m[2]), num(m[3])]
    const weightFirst = a >= 20 || a === 0 || (!Number.isInteger(a) && c <= 10)
    const [weight, reps, sets] = weightFirst ? [a, b, c] : [c, b, a]
    return withRpe(Array.from({ length: Math.min(20, sets) }, () => ({ weightKg: weight, reps })))
  }

  // sets x reps + weight somewhere ("3x8 80", "3x8 @80" handled above as rpe if ≤10)
  m = t.match(/(\d+)x(\d+)/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    const rest = (t.slice(0, m.index) + " " + t.slice(m.index! + m[0].length)).match(/(\d+(?:[.,]\d+)?)/)
    if (a <= 10 && rest) return withRpe(Array.from({ length: a }, () => ({ weightKg: num(rest[1]), reps: b })))
    if (a >= 20 || a === 0) return withRpe([{ weightKg: a, reps: b }])
    return withRpe(Array.from({ length: a }, () => ({ weightKg: 0, reps: b })))
  }

  // "100 5 reps"
  m = t.match(/(\d+(?:[.,]\d+)?)\s+(\d+)\s*reps?/)
  if (m) return withRpe([{ weightKg: num(m[1]), reps: Number(m[2]) }])
  return null
}

function parseCardio(text: string): { minutes?: number; distanceKm?: number } | null {
  const t = norm(text)
  const km = t.match(/(\d+(?:[.,]\d+)?)\s*(km|k)\b/)
  const meters = t.match(/(\d{3,5})\s*m(?:ts|etros)?\b/)
  const hours = t.match(/(\d+(?:[.,]\d+)?)\s*(h|hs|hora|horas)\b/)
  const min = t.match(/(\d+)\s*(min|mins|minutos|')/)
  const hm = t.match(/(\d+)h(\d{1,2})\b/)
  const minutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) : (hours ? num(hours[1]) * 60 : 0) + (min ? Number(min[1]) : 0)
  const distanceKm = km ? num(km[1]) : meters ? Number(meters[1]) / 1000 : undefined
  if (!minutes && distanceKm == null) return null
  return { minutes: minutes || undefined, distanceKm }
}

const PAST_TENSE_EXERCISE: [RegExp, string][] = [
  [/^corri\b/, "running"],
  [/^nade\b/, "swimming"],
  [/^camine\b/, "walking"],
  [/^pedalee\b/, "cycling"],
  [/^rem(e|ee)\b/, "rowing"],
]

const CAFFEINE: [RegExp, number, string][] = [
  [/cafe doble|doble espresso|doppio/, 150, "Café doble"],
  [/cold brew/, 200, "Cold brew"],
  [/energizante|monster|red bull|speed/, 160, "Energizante"],
  [/mate/, 80, "Mate"],
  [/te verde|te negro|\bte\b/, 40, "Té"],
  [/cafe|espresso|cortado|capuchino|cappuccino|latte|americano/, 80, "Café"],
]

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult | null {
  const raw = input.trim()
  if (!raw) return null
  const t = norm(raw)

  // Explicit prefixes
  if (/^(tarea|task|todo|pendiente)\b/.test(t) || /(^|\s)!(alta|high|baja|low|media|medium|urgente)\b/.test(t)) return parseTask(raw, ctx)
  if (/^(comida|comi|almuerzo|cena|desayuno|merienda|snack)\b/.test(t) && !/\b(agua|cafe)\b/.test(t)) {
    const mealType = /^desayuno/.test(t) ? "breakfast" : /^almuerzo/.test(t) ? "lunch" : /^cena/.test(t) ? "dinner" : /^(merienda|snack)/.test(t) ? "snack" : undefined
    return { kind: "meal", description: raw.replace(/^(comida|comí|comi|almuerzo|cena|desayuno|merienda|snack)\s*:?\s*/i, ""), mealType }
  }

  // Water: "500 agua", "agua 1.5l", "2 vasos de agua", "+250"
  let m = t.match(/^(?:\+)?(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litros?|cc)?\s*(?:de )?agua$|^agua\s*(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litros?|cc)?$/)
  if (m) {
    const value = num(m[1] ?? m[3])
    const unit = m[2] ?? m[4]
    return { kind: "water", ml: Math.round(unit && /^l/.test(unit) ? value * 1000 : value < 10 ? value * 1000 : value) }
  }
  m = t.match(/^(\d+)\s*vasos?(?: de agua)?$|^(un|1) vaso(?: de agua)?$/)
  if (m) return { kind: "water", ml: (Number(m[1]) || 1) * (ctx.glassMl ?? 250) }
  if (/^\+\d+$/.test(t)) return { kind: "water", ml: Number(t.slice(1)) }

  // Weight: "peso 78.6", "78,6 kg", "peso 78.6 15%"
  m = t.match(/^(?:peso|weight|pese)\s*(\d+(?:[.,]\d+)?)\s*(?:kg)?(?:\s+(\d+(?:[.,]\d+)?)\s*%)?$|^(\d{2,3}(?:[.,]\d+)?)\s*kg$/)
  if (m) {
    const kg = num(m[1] ?? m[3])
    if (kg >= 25 && kg <= 350) return { kind: "weight", kg, ...(m[2] ? { bodyFatPct: num(m[2]) } : {}) }
  }

  // Check-in: "energia 4", "animo 3", "energia 4 animo 3"
  const energy = t.match(/\benergia\s*([1-5])\b/)
  const mood = t.match(/\b(animo|humor|mood)\s*([1-5])\b/)
  if ((energy || mood) && t.replace(/\b(energia|animo|humor|mood)\s*[1-5]\b/g, "").trim() === "") {
    return { kind: "checkin", energy: energy ? Number(energy[1]) : undefined, mood: mood ? Number(mood[2]) : undefined }
  }

  // User's own supplements and habits (exact-ish name match)
  for (const s of ctx.supplements ?? []) {
    const name = norm(s.name)
    if (t === name || t.startsWith(name + " ") || name.startsWith(t + " ") || (t.length >= 3 && name.split(" ")[0] === t)) {
      return { kind: "supplement", name: s.name, supplementId: s.id, dose: s.dose, unit: s.unit }
    }
  }
  for (const h of ctx.habits ?? []) {
    const name = norm(h.name)
    const firstWord = name.split(" ")[0]
    const stem = firstWord.slice(0, Math.max(4, firstWord.length - 2)) // "meditar" → "medit" matches "medité"
    if (t === name || (firstWord.length >= 4 && t.startsWith(stem) && t.split(" ").length <= 3)) {
      return { kind: "habit", habitId: h.id, name: h.name }
    }
  }

  // Caffeine
  for (const [re, mg, label] of CAFFEINE) {
    if (re.test(t) && t.split(" ").length <= 4) {
      const count = Number(t.match(/^(\d+)\s/)?.[1] ?? 1)
      return { kind: "caffeine", mg: mg * count, label }
    }
  }

  // Training: exercise name + numbers ("banca 80x8x3", "corrí 5 km en 25 min")
  const verb = PAST_TENSE_EXERCISE.find(([re]) => re.test(t))
  const ex = verb ? EXERCISES.find((e) => e.slug === verb[1]) ?? null : findExercise(t)
  if (ex && /\d/.test(t)) {
    if (ex.kind === "strength") {
      const sets = parseSets(t)
      if (sets?.length) return { kind: "sets", exercise: ex, sets }
    } else {
      const c = parseCardio(t)
      if (c) return { kind: "cardio", exercise: ex, ...c }
    }
  }

  // Supplement presets ("d3 2000", "creatina")
  const preset = findPreset(t)
  if (preset && t.split(" ").length <= 4) {
    const dose = t.match(/(?<![a-z\d])(\d+(?:[.,]\d+)?)/) // not the "3" in "d3"
    return { kind: "supplement", name: preset.name, presetKey: preset.key, dose: dose ? num(dose[1]) : preset.dose, unit: preset.unit }
  }

  // Dated imperative lines read as tasks ("llamar al dentista mañana")
  const due = parseDue(raw, ctx.today)
  if (due.date && /^(llamar|comprar|pagar|enviar|mandar|revisar|hacer|escribir|preparar|reservar|turno|call|buy|pay|send|review|write)\b/.test(t)) {
    return { kind: "task", title: due.rest, dueDate: due.date }
  }

  return { kind: "meal", description: raw }
}
