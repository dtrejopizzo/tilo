// Picking the best data source per metric and merging duplicate activities across sources.

export type Source = "apple" | "google_health" | "health_connect" | "strava" | "garmin" | "manual"

export interface DailyMetricRow {
  source: Source
  device?: string | null
  steps?: number | null
  distance_m?: number | null
  active_kcal?: number | null
  resting_kcal?: number | null
  resting_hr?: number | null
  hrv_ms?: number | null
  sleep_min?: number | null
}

export type MetricKey = "steps" | "distance_m" | "active_kcal" | "resting_kcal" | "resting_hr" | "hrv_ms" | "sleep_min"

export const DEFAULT_PRIORITY: Source[] = ["apple", "google_health", "health_connect", "garmin", "strava", "manual"]

const isWatch = (row: DailyMetricRow) => /watch|band|fitbit|pixel|garmin|amazfit|mi band|xiaomi/i.test(row.device ?? "")

// Steps and distance: the most complete source wins (a phone left on a desk under-counts).
// Everything else: a wrist device first, then the user's priority.
export function pickMetrics(
  rows: DailyMetricRow[],
  priority: Source[] = DEFAULT_PRIORITY,
  pinned: Partial<Record<MetricKey, Source>> = {},
): { values: Partial<Record<MetricKey, number>>; sources: Partial<Record<MetricKey, Source>> } {
  const values: Partial<Record<MetricKey, number>> = {}
  const sources: Partial<Record<MetricKey, Source>> = {}
  const rank = (s: Source) => {
    const i = priority.indexOf(s)
    return i === -1 ? priority.length : i
  }
  const keys: MetricKey[] = ["steps", "distance_m", "active_kcal", "resting_kcal", "resting_hr", "hrv_ms", "sleep_min"]
  for (const key of keys) {
    const candidates = rows.filter((r) => r[key] != null)
    if (!candidates.length) continue
    const pin = pinned[key]
    let chosen = pin ? candidates.find((r) => r.source === pin) : undefined
    if (!chosen) {
      chosen =
        key === "steps" || key === "distance_m"
          ? candidates.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a))
          : [...candidates].sort((a, b) => Number(isWatch(b)) - Number(isWatch(a)) || rank(a.source) - rank(b.source))[0]
    }
    values[key] = chosen[key] as number
    sources[key] = chosen.source
  }
  return { values, sources }
}

export interface ActivityLike {
  id: string
  source: Source
  type: string
  start_at: string
  end_at: string
  kcal?: number | null
  avg_hr?: number | null
  max_hr?: number | null
  distance_m?: number | null
  steps?: number | null
  elevation_m?: number | null
}

const SOURCE_SCORE: Record<Source, number> = { strava: 3, garmin: 3, apple: 2, google_health: 2, health_connect: 1, manual: 0 }

function richness(a: ActivityLike): number {
  return (a.avg_hr != null ? 4 : 0) + (a.kcal != null ? 2 : 0) + (a.distance_m != null ? 2 : 0) + (a.elevation_m != null ? 1 : 0) + SOURCE_SCORE[a.source]
}

function compatibleTypes(a: string, b: string): boolean {
  if (a === b) return true
  const generic = new Set(["other", "workout", "strength", "hiit"])
  return generic.has(a) || generic.has(b)
}

// Same session recorded by two sources (watch + Strava): overlap ≥ 50% of the shorter one
export function overlaps(a: ActivityLike, b: ActivityLike): boolean {
  const s = Math.max(Date.parse(a.start_at), Date.parse(b.start_at))
  const e = Math.min(Date.parse(a.end_at), Date.parse(b.end_at))
  const shorter = Math.min(Date.parse(a.end_at) - Date.parse(a.start_at), Date.parse(b.end_at) - Date.parse(b.start_at))
  return shorter > 0 && e - s >= shorter * 0.5
}

// Returns, for each duplicate, the id of the activity it should merge into, plus fields the primary is missing
export function dedupeActivities(activities: ActivityLike[]): {
  mergedInto: Map<string, string>
  fill: Map<string, Partial<ActivityLike>>
} {
  const sorted = [...activities].sort((a, b) => richness(b) - richness(a))
  const primaries: ActivityLike[] = []
  const mergedInto = new Map<string, string>()
  const fill = new Map<string, Partial<ActivityLike>>()
  for (const a of sorted) {
    const p = primaries.find((x) => x.source !== a.source && compatibleTypes(x.type, a.type) && overlaps(x, a))
    if (!p) {
      primaries.push(a)
      continue
    }
    mergedInto.set(a.id, p.id)
    const extra: Partial<ActivityLike> = { ...(fill.get(p.id) ?? {}) }
    for (const k of ["kcal", "avg_hr", "max_hr", "distance_m", "steps", "elevation_m"] as const) {
      if (p[k] == null && a[k] != null && extra[k] == null) extra[k] = a[k]
    }
    if (Object.keys(extra).length) fill.set(p.id, extra)
  }
  return { mergedInto, fill }
}

// Normalised activity types across providers
const TYPE_MAP: Record<string, string> = {
  run: "run", running: "run", trailrun: "run", virtualrun: "run", treadmill: "run",
  ride: "ride", cycling: "ride", virtualride: "ride", ebikeride: "ride", gravelride: "ride", mountainbikeride: "ride", spinning: "ride", indoorcycling: "ride",
  swim: "swim", swimming: "swim", poolswim: "swim", openwaterswim: "swim",
  walk: "walk", walking: "walk", hike: "hike", hiking: "hike",
  weighttraining: "strength", traditionalstrengthtraining: "strength", functionalstrengthtraining: "strength", strength: "strength",
  strengthtraining: "strength", crossfit: "hiit", highintensityintervaltraining: "hiit", hiit: "hiit", workout: "other",
  tennis: "tennis", padel: "padel", pickleball: "tennis", soccer: "football", football: "football",
  yoga: "yoga", pilates: "yoga", rowing: "rowing", rowingmachine: "rowing", elliptical: "elliptical", stairstepper: "other",
  golf: "golf", climbing: "climbing", rockclimbing: "climbing", bouldering: "climbing", boxing: "boxing", kickboxing: "boxing",
  martialarts: "martial_arts", dance: "dance", dancing: "dance", skiing: "ski", alpineski: "ski", nordicski: "ski", snowboard: "ski",
  surfing: "surf", surf: "surf", kitesurf: "surf", windsurf: "surf", standuppaddling: "surf", basketball: "basketball",
  volleyball: "volleyball", rugby: "rugby", hockey: "hockey", squash: "tennis", badminton: "tennis", tabletennis: "tennis",
  skating: "skate", inlineskate: "skate", stretching: "mobility", flexibility: "mobility", mindandbody: "yoga", cooldown: "mobility",
  coretraining: "strength", functionaltraining: "strength", weightlifting: "strength", gym: "strength", kayaking: "rowing", canoeing: "rowing",
}

// Keyword fallback for descriptive names ("Outdoor Run", "Traditional Strength Training", "Pool Swim")
const KEYWORDS: [RegExp, string][] = [
  [/golf/, "golf"],
  [/climb|escalad|boulder/, "climbing"],
  [/box|kickbox/, "boxing"],
  [/surf|paddle/, "surf"],
  [/ski|snowboard/, "ski"],
  [/danc|baile/, "dance"],
  [/hiit|interval|crossfit/, "hiit"],
  [/strength|weight|gym|musculaci/, "strength"],
  [/trail|run|jog|treadmill|correr|carrera/, "run"],
  [/hik|trek/, "hike"],
  [/walk|camin/, "walk"],
  [/cycl|ride|bike|bici|spin/, "ride"],
  [/swim|nata/, "swim"],
  [/yoga|pilates/, "yoga"],
  [/padel|pádel/, "padel"],
  [/tennis|tenis|pickle/, "tennis"],
  [/soccer|football|futbol|fútbol/, "football"],
  [/row|remo/, "rowing"],
  [/elliptical|elíptic|eliptic/, "elliptical"],
]

export function normaliseActivityType(raw: string): string {
  const exact = TYPE_MAP[raw.toLowerCase().replace(/[^a-z]/g, "")]
  if (exact) return exact
  const lower = raw.toLowerCase()
  return KEYWORDS.find(([re]) => re.test(lower))?.[1] ?? "other"
}


// ---------- Habits completed by activities ----------

// Activity types (normalised, as above) that count for a habit, read from its name in Spanish or
// English: "Correr" → run, "Entrenar fuerza" → strength, "Nadar" → swim, "Jugar al golf" → golf.
// "Entrenar" alone counts any gym-like session (strength, HIIT, the generic "workout" Apple and
// Google send for strength). Returns null when the name isn't about exercise ("Leer 20 min").
const HABIT_PATTERNS: [RegExp, string[]][] = [
  [/\b(corr(er|o|i)|running|run|trot(ar|e)|jogging|footing)\b/, ["run"]],
  [/\b(nad(ar|o|e)|nataci[oó]n|swim(ming)?|pileta|piscina)\b/, ["swim"]],
  [/\b(camin(ar|o|ata|e)|walk(ing)?|pasos)\b/, ["walk", "hike"]],
  [/\b(trekking|hiking|hike|senderismo|monta[nñ]a)\b/, ["hike", "walk"]],
  [/\b(bici(cleta)?|ciclismo|pedal(ear)?|spinning|cycling|ride|bike|mtb)\b/, ["ride"]],
  [/\b(fuerza|pesas|gym|gimnasio|musculaci[oó]n|strength|weights?|lifting|hipertrofia|crossfit|funcional)\b/, ["strength", "hiit", "other"]],
  // "Entrenar" means the gym, not a run or a swim (those have their own habits)
  [/\b(entren(ar|o|amiento)|workout|training)\b/, ["strength", "hiit", "other"]],
  // "Hacer ejercicio" / "deporte": any session counts
  [/\b(ejercicio|deporte|actividad f[ií]sica|mover(me|se))\b/, ["strength", "hiit", "other", "run", "ride", "swim", "walk", "elliptical", "rowing", "tennis", "padel", "football", "golf", "yoga"]],
  [/\b(hiit|intervalos)\b/, ["hiit"]],
  [/\b(yoga|pilates|stretch(ing)?|elongar|elongaci[oó]n|movilidad|mobility)\b/, ["yoga", "mobility"]],
  [/\b(golf)\b/, ["golf"]],
  [/\b(tenis|tennis|squash|badminton|ping ?pong)\b/, ["tennis"]],
  [/\b(p[aá]del|padel)\b/, ["padel", "tennis"]],
  [/\b(f[uú]tbol|futbol|soccer|football|f[uú]tbol 5)\b/, ["football"]],
  [/\b(remo|rowing|kayak)\b/, ["rowing"]],
  [/\b(escalar|escalada|climb(ing)?|boulder)\b/, ["climbing"]],
  [/\b(box(eo|ing)?|kickboxing|artes marciales|jiu ?jitsu|karate|judo|taekwondo|muay thai)\b/, ["boxing", "martial_arts"]],
  [/\b(bail(ar|e)|danza|dance)\b/, ["dance"]],
  [/\b(surf|kite|windsurf|sup)\b/, ["surf"]],
  [/\b(esqu[ií](ar)?|ski(ing)?|snowboard)\b/, ["ski"]],
  [/\b(el[ií]ptic[oa]|elliptical)\b/, ["elliptical"]],
  [/\b(b[aá]squet|basket(ball)?|v[oó]ley|volley(ball)?|rugby|hockey)\b/, ["basketball", "volleyball", "rugby", "hockey"]],
]

export function inferHabitActivityTypes(name: string): string[] | null {
  const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const plain = name.toLowerCase()
  const types = new Set<string>()
  for (const [re, t] of HABIT_PATTERNS) if (re.test(n) || re.test(plain)) t.forEach((x) => types.add(x))
  return types.size ? [...types] : null
}

// Minutes a session needs to count, from "Correr 30 min", "caminar 10.000 pasos" (ignored) or a default
export function inferHabitMinMinutes(name: string): number {
  const m = name.toLowerCase().match(/(\d{1,3})\s*(min|minutos|')\b/)
  return m ? Math.min(240, Number(m[1])) : 10
}
