// Global exercise library. Seeded into public.exercises (scripts/gen-exercise-seed.ts)
// and used by the quick-add parser to recognise exercise names.

export type Muscle =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps" | "forearms"
  | "quads" | "hamstrings" | "glutes" | "calves" | "core" | "full_body" | "cardio"

export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "band" | "smith" | "other"

export interface ExerciseDef {
  slug: string
  name: string
  name_es: string
  primary: Muscle
  secondary: Muscle[]
  equipment: Equipment
  kind: "strength" | "cardio" | "mobility"
  met: number
  aliases?: string[] // extra spellings for the quick-add parser (lowercase)
}

type Row = [slug: string, name: string, nameEs: string, primary: Muscle, secondary: Muscle[], equipment: Equipment, met: number, aliases?: string[]]

const STRENGTH: Row[] = [
  // chest
  ["bench-press", "Bench Press", "Press banca", "chest", ["triceps", "shoulders"], "barbell", 6, ["banca", "press de banca", "bench"]],
  ["incline-bench-press", "Incline Bench Press", "Press inclinado con barra", "chest", ["shoulders", "triceps"], "barbell", 6, ["banca inclinada", "press inclinado"]],
  ["decline-bench-press", "Decline Bench Press", "Press declinado", "chest", ["triceps"], "barbell", 6],
  ["dumbbell-bench-press", "Dumbbell Bench Press", "Press banca con mancuernas", "chest", ["triceps", "shoulders"], "dumbbell", 6, ["press mancuernas", "banca mancuernas"]],
  ["incline-dumbbell-press", "Incline Dumbbell Press", "Press inclinado con mancuernas", "chest", ["shoulders", "triceps"], "dumbbell", 6, ["inclinado mancuernas"]],
  ["dumbbell-fly", "Dumbbell Fly", "Aperturas con mancuernas", "chest", [], "dumbbell", 5, ["aperturas"]],
  ["cable-crossover", "Cable Crossover", "Cruce de poleas", "chest", [], "cable", 5, ["cruce poleas", "crossover"]],
  ["pec-deck", "Pec Deck", "Peck deck", "chest", [], "machine", 5, ["contractora", "pec deck"]],
  ["chest-press-machine", "Chest Press Machine", "Press de pecho en máquina", "chest", ["triceps"], "machine", 5],
  ["push-up", "Push-up", "Flexiones", "chest", ["triceps", "shoulders", "core"], "bodyweight", 8, ["flexiones", "lagartijas"]],
  ["dips", "Dips", "Fondos", "chest", ["triceps", "shoulders"], "bodyweight", 8, ["fondos", "paralelas"]],
  ["smith-bench-press", "Smith Machine Bench Press", "Press banca en Smith", "chest", ["triceps"], "smith", 6],
  // back
  ["deadlift", "Deadlift", "Peso muerto", "back", ["hamstrings", "glutes", "forearms"], "barbell", 6, ["muerto", "peso muerto convencional"]],
  ["sumo-deadlift", "Sumo Deadlift", "Peso muerto sumo", "back", ["glutes", "quads"], "barbell", 6, ["sumo"]],
  ["pull-up", "Pull-up", "Dominadas", "back", ["biceps"], "bodyweight", 8, ["dominadas", "dominada"]],
  ["chin-up", "Chin-up", "Dominadas supinas", "back", ["biceps"], "bodyweight", 8, ["dominadas supinas"]],
  ["lat-pulldown", "Lat Pulldown", "Jalón al pecho", "back", ["biceps"], "cable", 5, ["jalon", "jalón", "polea al pecho", "dorsalera"]],
  ["barbell-row", "Barbell Row", "Remo con barra", "back", ["biceps", "forearms"], "barbell", 6, ["remo barra", "remo con barra"]],
  ["pendlay-row", "Pendlay Row", "Remo Pendlay", "back", ["biceps"], "barbell", 6],
  ["dumbbell-row", "One-arm Dumbbell Row", "Remo con mancuerna", "back", ["biceps"], "dumbbell", 5, ["remo mancuerna", "serrucho"]],
  ["seated-cable-row", "Seated Cable Row", "Remo sentado en polea", "back", ["biceps"], "cable", 5, ["remo bajo", "remo polea", "gironda"]],
  ["t-bar-row", "T-Bar Row", "Remo en T", "back", ["biceps"], "barbell", 6, ["remo t"]],
  ["chest-supported-row", "Chest-supported Row", "Remo con apoyo en pecho", "back", ["biceps"], "machine", 5],
  ["straight-arm-pulldown", "Straight-arm Pulldown", "Pullover en polea", "back", [], "cable", 4, ["pullover polea"]],
  ["face-pull", "Face Pull", "Face pull", "shoulders", ["back"], "cable", 4, ["face pull"]],
  ["back-extension", "Back Extension", "Hiperextensiones", "back", ["glutes", "hamstrings"], "bodyweight", 4, ["hiperextensiones", "lumbares"]],
  ["shrug", "Barbell Shrug", "Encogimientos", "back", ["forearms"], "barbell", 4, ["encogimientos", "trapecio"]],
  // shoulders
  ["overhead-press", "Overhead Press", "Press militar", "shoulders", ["triceps", "core"], "barbell", 6, ["militar", "press militar", "ohp"]],
  ["dumbbell-shoulder-press", "Dumbbell Shoulder Press", "Press de hombros con mancuernas", "shoulders", ["triceps"], "dumbbell", 6, ["press hombros", "press arnold"]],
  ["arnold-press", "Arnold Press", "Press Arnold", "shoulders", ["triceps"], "dumbbell", 6],
  ["lateral-raise", "Lateral Raise", "Vuelos laterales", "shoulders", [], "dumbbell", 4, ["vuelos laterales", "elevaciones laterales", "laterales"]],
  ["cable-lateral-raise", "Cable Lateral Raise", "Vuelos laterales en polea", "shoulders", [], "cable", 4],
  ["front-raise", "Front Raise", "Vuelos frontales", "shoulders", [], "dumbbell", 4, ["frontales"]],
  ["rear-delt-fly", "Rear Delt Fly", "Pájaros", "shoulders", ["back"], "dumbbell", 4, ["pajaros", "pájaros", "posteriores"]],
  ["upright-row", "Upright Row", "Remo al mentón", "shoulders", ["back"], "barbell", 5, ["remo al menton"]],
  ["shoulder-press-machine", "Shoulder Press Machine", "Press de hombros en máquina", "shoulders", ["triceps"], "machine", 5],
  // arms
  ["barbell-curl", "Barbell Curl", "Curl con barra", "biceps", ["forearms"], "barbell", 4, ["curl barra", "biceps barra"]],
  ["dumbbell-curl", "Dumbbell Curl", "Curl con mancuernas", "biceps", ["forearms"], "dumbbell", 4, ["curl mancuernas", "biceps mancuerna"]],
  ["hammer-curl", "Hammer Curl", "Curl martillo", "biceps", ["forearms"], "dumbbell", 4, ["martillo"]],
  ["preacher-curl", "Preacher Curl", "Curl predicador", "biceps", [], "barbell", 4, ["scott", "predicador"]],
  ["incline-dumbbell-curl", "Incline Dumbbell Curl", "Curl inclinado", "biceps", [], "dumbbell", 4],
  ["cable-curl", "Cable Curl", "Curl en polea", "biceps", [], "cable", 4],
  ["triceps-pushdown", "Triceps Pushdown", "Tríceps en polea", "triceps", [], "cable", 4, ["triceps polea", "tríceps polea", "extension polea"]],
  ["overhead-triceps-extension", "Overhead Triceps Extension", "Extensión de tríceps sobre la cabeza", "triceps", [], "dumbbell", 4, ["triceps trasnuca", "copa"]],
  ["skull-crusher", "Skull Crusher", "Press francés", "triceps", [], "barbell", 4, ["press frances", "press francés"]],
  ["close-grip-bench-press", "Close-grip Bench Press", "Press banca agarre cerrado", "triceps", ["chest"], "barbell", 6, ["banca cerrada"]],
  ["triceps-kickback", "Triceps Kickback", "Patada de tríceps", "triceps", [], "dumbbell", 4, ["patada triceps"]],
  ["wrist-curl", "Wrist Curl", "Curl de muñeca", "forearms", [], "barbell", 3],
  ["farmers-walk", "Farmer's Walk", "Paseo del granjero", "forearms", ["full_body", "core"], "dumbbell", 6, ["granjero", "farmer"]],
  // legs
  ["back-squat", "Back Squat", "Sentadilla", "quads", ["glutes", "hamstrings", "core"], "barbell", 6, ["sentadilla", "sentadillas", "squat"]],
  ["front-squat", "Front Squat", "Sentadilla frontal", "quads", ["glutes", "core"], "barbell", 6, ["frontal"]],
  ["goblet-squat", "Goblet Squat", "Sentadilla goblet", "quads", ["glutes"], "dumbbell", 6, ["goblet"]],
  ["hack-squat", "Hack Squat", "Sentadilla hack", "quads", ["glutes"], "machine", 6, ["hack"]],
  ["leg-press", "Leg Press", "Prensa", "quads", ["glutes"], "machine", 6, ["prensa", "prensa 45"]],
  ["bulgarian-split-squat", "Bulgarian Split Squat", "Sentadilla búlgara", "quads", ["glutes"], "dumbbell", 6, ["bulgara", "búlgara", "bulgaras"]],
  ["lunge", "Walking Lunge", "Estocadas", "quads", ["glutes", "hamstrings"], "dumbbell", 6, ["estocadas", "zancadas"]],
  ["leg-extension", "Leg Extension", "Sillón de cuádriceps", "quads", [], "machine", 4, ["sillon", "sillón", "extensiones de piernas", "camilla cuadriceps"]],
  ["romanian-deadlift", "Romanian Deadlift", "Peso muerto rumano", "hamstrings", ["glutes", "back"], "barbell", 6, ["rumano", "peso muerto rumano", "rdl"]],
  ["stiff-leg-deadlift", "Stiff-leg Deadlift", "Peso muerto piernas rígidas", "hamstrings", ["glutes"], "barbell", 6, ["piernas rigidas"]],
  ["lying-leg-curl", "Lying Leg Curl", "Camilla de isquios", "hamstrings", [], "machine", 4, ["camilla", "curl femoral", "isquios"]],
  ["seated-leg-curl", "Seated Leg Curl", "Curl femoral sentado", "hamstrings", [], "machine", 4],
  ["nordic-curl", "Nordic Curl", "Curl nórdico", "hamstrings", [], "bodyweight", 5, ["nordico", "nórdico"]],
  ["hip-thrust", "Hip Thrust", "Hip thrust", "glutes", ["hamstrings"], "barbell", 5, ["hip thrust", "empuje de cadera"]],
  ["glute-bridge", "Glute Bridge", "Puente de glúteos", "glutes", ["hamstrings"], "bodyweight", 4, ["puente gluteo"]],
  ["cable-kickback", "Cable Glute Kickback", "Patada de glúteo en polea", "glutes", [], "cable", 4, ["patada gluteo"]],
  ["hip-abduction", "Hip Abduction Machine", "Abductores", "glutes", [], "machine", 4, ["abductores"]],
  ["hip-adduction", "Hip Adduction Machine", "Aductores", "quads", [], "machine", 4, ["aductores"]],
  ["standing-calf-raise", "Standing Calf Raise", "Gemelos de pie", "calves", [], "machine", 4, ["gemelos", "pantorrillas"]],
  ["seated-calf-raise", "Seated Calf Raise", "Gemelos sentado", "calves", [], "machine", 4, ["soleo", "sóleo"]],
  ["step-up", "Step-up", "Subidas al cajón", "quads", ["glutes"], "dumbbell", 6, ["step up", "subidas"]],
  // core
  ["plank", "Plank", "Plancha", "core", [], "bodyweight", 4, ["plancha"]],
  ["side-plank", "Side Plank", "Plancha lateral", "core", [], "bodyweight", 4],
  ["crunch", "Crunch", "Abdominales", "core", [], "bodyweight", 4, ["abdominales", "crunch"]],
  ["hanging-leg-raise", "Hanging Leg Raise", "Elevación de piernas colgado", "core", [], "bodyweight", 5, ["elevacion de piernas"]],
  ["cable-crunch", "Cable Crunch", "Crunch en polea", "core", [], "cable", 4],
  ["ab-wheel", "Ab Wheel Rollout", "Rueda abdominal", "core", [], "other", 5, ["rueda"]],
  ["russian-twist", "Russian Twist", "Giros rusos", "core", [], "bodyweight", 4],
  ["pallof-press", "Pallof Press", "Press Pallof", "core", [], "cable", 4],
  // full body / power
  ["power-clean", "Power Clean", "Cargada de potencia", "full_body", ["back", "quads"], "barbell", 8, ["cargada", "clean"]],
  ["clean-and-jerk", "Clean and Jerk", "Dos tiempos", "full_body", ["shoulders", "quads"], "barbell", 8],
  ["snatch", "Snatch", "Arranque", "full_body", ["shoulders", "back"], "barbell", 8, ["arranque"]],
  ["thruster", "Thruster", "Thruster", "full_body", ["quads", "shoulders"], "barbell", 8],
  ["kettlebell-swing", "Kettlebell Swing", "Swing con kettlebell", "glutes", ["hamstrings", "back"], "kettlebell", 8, ["swing", "kb swing"]],
  ["turkish-get-up", "Turkish Get-up", "Levantada turca", "full_body", ["core", "shoulders"], "kettlebell", 6],
  ["burpee", "Burpee", "Burpees", "full_body", ["chest", "quads"], "bodyweight", 8, ["burpees"]],
  ["box-jump", "Box Jump", "Saltos al cajón", "quads", ["glutes", "calves"], "bodyweight", 8, ["saltos al cajon"]],
  ["wall-ball", "Wall Ball", "Wall ball", "full_body", ["quads", "shoulders"], "other", 8],
  ["sled-push", "Sled Push", "Empuje de trineo", "full_body", ["quads"], "other", 8, ["trineo"]],
  ["battle-ropes", "Battle Ropes", "Sogas de batalla", "full_body", ["shoulders"], "other", 8, ["sogas"]],
]

type CardioRow = [slug: string, name: string, nameEs: string, met: number, aliases?: string[]]

const CARDIO: CardioRow[] = [
  ["running", "Running", "Correr", 9.8, ["correr", "corrida", "run", "trote", "trotar"]],
  ["treadmill", "Treadmill Run", "Cinta", 9, ["cinta", "treadmill"]],
  ["walking", "Walking", "Caminata", 3.8, ["caminar", "caminata", "walk"]],
  ["incline-walk", "Incline Treadmill Walk", "Caminata en cinta inclinada", 6, ["cinta inclinada"]],
  ["hiking", "Hiking", "Trekking", 6, ["trekking", "senderismo", "hike"]],
  ["cycling", "Cycling", "Ciclismo", 7.5, ["bici", "bicicleta", "ciclismo", "ride"]],
  ["indoor-cycling", "Indoor Cycling", "Bici fija / spinning", 8.5, ["spinning", "bici fija"]],
  ["rowing", "Rowing Machine", "Remo ergómetro", 7, ["remoergometro", "remo ergometro", "row"]],
  ["elliptical", "Elliptical", "Elíptico", 5, ["eliptico", "elíptico"]],
  ["stair-climber", "Stair Climber", "Escaladora", 9, ["escaladora", "escalera"]],
  ["swimming", "Swimming", "Natación", 8.3, ["natacion", "natación", "nadar", "swim"]],
  ["jump-rope", "Jump Rope", "Soga", 11, ["soga", "saltar la soga"]],
  ["hiit", "HIIT", "HIIT", 8, ["hiit", "intervalos"]],
  ["tennis", "Tennis", "Tenis", 7.3, ["tenis"]],
  ["padel", "Padel", "Pádel", 6, ["padel", "pádel"]],
  ["football", "Football (soccer)", "Fútbol", 7, ["futbol", "fútbol", "fulbo"]],
  ["basketball", "Basketball", "Básquet", 6.5, ["basquet", "básquet"]],
  ["boxing", "Boxing", "Boxeo", 7.8, ["boxeo"]],
  ["martial-arts", "Martial Arts", "Artes marciales", 10, ["bjj", "jiu jitsu", "muay thai"]],
  ["yoga", "Yoga", "Yoga", 2.5, ["yoga"]],
  ["pilates", "Pilates", "Pilates", 3, ["pilates"]],
  ["stretching", "Stretching", "Elongación", 2.3, ["elongacion", "elongación", "estiramientos"]],
]

export const EXERCISES: ExerciseDef[] = [
  ...STRENGTH.map(([slug, name, name_es, primary, secondary, equipment, met, aliases]) => ({
    slug, name, name_es, primary, secondary, equipment, kind: "strength" as const, met, aliases,
  })),
  ...CARDIO.map(([slug, name, name_es, met, aliases]) => ({
    slug,
    name,
    name_es,
    primary: "cardio" as Muscle,
    secondary: [] as Muscle[],
    equipment: "other" as Equipment,
    kind: (slug === "yoga" || slug === "stretching" || slug === "pilates" ? "mobility" : "cardio") as ExerciseDef["kind"],
    met,
    aliases,
  })),
]

export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: "Pecho", back: "Espalda", shoulders: "Hombros", biceps: "Bíceps", triceps: "Tríceps", forearms: "Antebrazos",
  quads: "Cuádriceps", hamstrings: "Isquios", glutes: "Glúteos", calves: "Gemelos", core: "Core", full_body: "Cuerpo completo",
  cardio: "Cardio",
}

function normalise(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()
}

// Best match for free text ("banca", "press militar", "peso muerto rumano"); longest alias wins
export function findExercise(text: string, library: ExerciseDef[] = EXERCISES): ExerciseDef | null {
  const t = normalise(text)
  let best: { ex: ExerciseDef; len: number } | null = null
  for (const ex of library) {
    for (const candidate of [ex.name, ex.name_es, ex.slug.replace(/-/g, " "), ...(ex.aliases ?? [])]) {
      const c = normalise(candidate)
      if (c && (t === c || t.startsWith(c + " ") || t.includes(" " + c) || t.startsWith(c)) && (!best || c.length > best.len)) {
        best = { ex, len: c.length }
      }
    }
  }
  return best?.ex ?? null
}
