// One-time migration of the old Firebase data into Supabase.
//
//   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/migrate-firestore.ts --dry-run          # counts only
//   npx tsx scripts/migrate-firestore.ts                     # migrate everyone
//   npx tsx scripts/migrate-firestore.ts --email=you@gmail.com
//
// Users are matched by email. A Supabase user is created when missing; when that person later
// signs in with Google using the same email, Supabase links the Google identity to it.
// OAuth connections (Strava, Google) are not copied: reconnect them from Settings → Conexiones.
import { createClient } from "@supabase/supabase-js"
import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore, type DocumentData } from "firebase-admin/firestore"

const DRY = process.argv.includes("--dry-run")
const ONLY = process.argv.find((a) => a.startsWith("--email="))?.slice(8).toLowerCase()

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!sa || !url || !key) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const fs = getFirestore(initializeApp({ credential: cert(JSON.parse(sa)) }))
const sb = createClient(url, key, { auth: { persistSession: false } })

const TYPE: Record<string, string> = { Run: "run", Swim: "swim", Cycle: "ride", Tennis: "tennis", Strength: "strength", Walk: "walk", Hike: "hike", Other: "other" }
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)

async function byUser(collection: string, uid: string): Promise<(DocumentData & { _id: string })[]> {
  const snap = await fs.collection(collection).where("userId", "==", uid).get()
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }))
}

async function findOrCreateUser(email: string, name: string): Promise<string> {
  for (let page = 1; page < 50; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) break
  }
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  return data.user.id
}

async function insert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  if (DRY || !rows.length) return
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = onConflict
      ? await sb.from(table).upsert(chunk, { onConflict, ignoreDuplicates: true })
      : await sb.from(table).insert(chunk)
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

async function migrateUser(fbUid: string, profile: DocumentData) {
  const email = String(profile.email ?? "").toLowerCase()
  if (!email || (ONLY && email !== ONLY)) return
  const name = profile.name ?? email.split("@")[0]
  const uid = DRY ? "(dry-run)" : await findOrCreateUser(email, name)
  const counts: Record<string, number> = {}

  // Profile and goals
  const birthYear = profile.age ? new Date().getFullYear() - Number(profile.age) : null
  if (!DRY) {
    await sb.from("profiles").update({
      name,
      sex: profile.gender === "male" || profile.gender === "female" ? profile.gender : null,
      height_cm: profile.height ?? null,
      birth_date: birthYear ? `${birthYear}-07-01` : null, // only age was stored: mid-year estimate
    }).eq("id", uid)
    await sb.from("goals").update({ kcal: profile.targetCalories ?? 2200, water_ml: profile.targetWater ?? 2500 }).eq("user_id", uid)
  }

  // Projects (from task project names)
  const tasks = await byUser("tasks", fbUid)
  const projectNames = [...new Set(tasks.map((t) => String(t.project || "Personal")))]
  const projectIds = new Map<string, string>()
  if (!DRY) {
    const { data: existing } = await sb.from("projects").select("id, name").eq("user_id", uid)
    for (const p of existing ?? []) projectIds.set(p.name, p.id)
    for (const [i, n] of projectNames.entries()) {
      if (projectIds.has(n)) continue
      const { data } = await sb.from("projects").insert({ user_id: uid, name: n.slice(0, 60), position: 10 + i }).select("id").single()
      if (data) projectIds.set(n, data.id)
    }
  }
  await insert(
    "tasks",
    tasks.map((t) => {
      const done = t.status === "Done"
      return {
        user_id: uid, title: String(t.title ?? "(sin título)").slice(0, 300), project_id: projectIds.get(String(t.project || "Personal")) ?? null,
        priority: String(t.priority ?? "Medium").toLowerCase(), status: done ? "done" : "todo",
        due_date: isDate(t.deadline) ? t.deadline : null,
        completed_on: done ? (isDate(t.completedAt) ? t.completedAt : isDate(t.deadline) ? t.deadline : new Date().toISOString().slice(0, 10)) : null,
        source: "import",
      }
    }),
  )
  counts.tasks = tasks.length

  // Habits and their completions
  const habits = await byUser("habits", fbUid)
  counts.habits = habits.length
  counts.habit_logs = 0
  for (const [i, h] of habits.entries()) {
    const dates = Object.entries(h.completions ?? {}).filter(([d, v]) => v && isDate(d)).map(([d]) => d)
    counts.habit_logs += dates.length
    if (DRY) continue
    const { data } = await sb.from("habits").insert({ user_id: uid, name: String(h.name).slice(0, 80), frequency: h.frequency === "Weekly" ? "weekly" : "daily", per_week: h.frequency === "Weekly" ? 3 : 7, position: i }).select("id").single()
    if (data) await insert("habit_logs", dates.map((date) => ({ habit_id: data.id, user_id: uid, date, source: "manual" })), "habit_id,date")
  }

  const meals = await byUser("meals", fbUid)
  await insert(
    "meals",
    meals.filter((m) => isDate(m.date)).map((m) => ({
      user_id: uid, date: m.date, description: String(m.description ?? "Comida").slice(0, 500),
      meal_type: ["breakfast", "lunch", "dinner", "snack"].includes(String(m.mealType).toLowerCase()) ? String(m.mealType).toLowerCase() : null,
      kcal: Number(m.calories) || 0, protein_g: Number(m.proteins) || 0, carbs_g: Number(m.carbs) || 0, fat_g: Number(m.fat) || 0, fiber_g: Number(m.fiber) || 0,
      source: "import",
    })),
  )
  counts.meals = meals.length

  const water = await byUser("water", fbUid)
  await insert("water_logs", water.filter((w) => isDate(w.date) && Number(w.amount) > 0).map((w) => ({ user_id: uid, date: w.date, ml: Math.min(5000, Math.round(Number(w.amount))) })))
  counts.water = water.length

  const weight = await byUser("weight", fbUid)
  await insert("weight_logs", weight.filter((w) => isDate(w.date) && Number(w.value) >= 20).map((w) => ({ user_id: uid, date: w.date, kg: Number(w.value), source: "import" })))
  counts.weight = weight.length

  const sports = await byUser("sports", fbUid)
  await insert(
    "activities",
    sports.filter((s) => isDate(s.date)).map((s) => {
      const start = new Date(`${s.date}T12:00:00-03:00`)
      const duration = Math.round((Number(s.duration) || 0) * 60)
      return {
        user_id: uid, source: s.stravaActivityId ? "strava" : "manual", external_id: String(s.stravaActivityId ?? s._id),
        type: TYPE[s.type] ?? "other", name: s.name ?? null, date: s.date, start_at: start.toISOString(),
        end_at: new Date(start.getTime() + duration * 1000).toISOString(), duration_s: duration,
        distance_m: s.distance ? Number(s.distance) * 1000 : null, kcal: s.calories ? Number(s.calories) : null,
      }
    }),
    "user_id,source,external_id",
  )
  counts.activities = sports.length

  console.log(`${DRY ? "[dry-run] " : ""}${email} → ${uid}`, counts)
}

const users = await fs.collection("users").get()
console.log(`Found ${users.size} Firebase users${DRY ? " (dry run: nothing is written)" : ""}`)
for (const doc of users.docs) {
  try {
    await migrateUser(doc.id, doc.data())
  } catch (e) {
    console.error(`Failed for ${doc.data().email}:`, e)
  }
}
console.log("Done. Users can now sign in with Google; ask them to reconnect Strava/Gmail in Settings → Conexiones.")
process.exit(0)
