import { buildProgress } from "@tilo/core/progress"
import { apiRoute, parseDate, PaymentRequiredError } from "@/lib/server/apiRoute"
import { readProgress } from "@/lib/server/ai"
import { calendarEvents } from "@/lib/server/google"
import { ServerTiloApi } from "@/lib/server/tiloServer"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const FRESH_MS = 4 * 3600_000

// GET ?date= → progress against the person's goals over the last two weeks, plus a short reading by
// the cheap AI model (cached for a few hours in settings, regenerated with ?refresh=1)
export const GET = apiRoute(async ({ uid, req }) => {
  const today = parseDate(req.nextUrl.searchParams.get("date"))
  const range = await new ServerTiloApi(uid).getRange(addDays(today, -20), today)
  const report = buildProgress(range, today)

  const db = supabaseAdmin()
  const { data: row } = await db.from("settings").select("data").eq("user_id", uid).maybeSingle()
  const data = (row?.data ?? {}) as Record<string, unknown>
  const cached = data.insights_cache as { date: string; at: number; bullets: string[] } | undefined
  let bullets = cached?.date === today && Date.now() - cached.at < FRESH_MS ? cached.bullets : null
  let aiError: string | null = null

  if (!bullets || req.nextUrl.searchParams.get("refresh") === "1") {
    const { data: profile } = await db.from("profiles").select("timezone, sex, birth_date").eq("id", uid).single()
    const meetings = await calendarEvents(uid, today, profile?.timezone ?? "UTC").then((e) => e.length).catch(() => null)
    try {
      bullets = await readProgress(uid, { ...report.facts, meetings_today: meetings, sex: profile?.sex ?? null }, today)
      await db.from("settings").upsert({ user_id: uid, data: { ...data, insights_cache: { date: today, at: Date.now(), bullets } }, updated_at: new Date().toISOString() })
    } catch (e) {
      aiError = e instanceof PaymentRequiredError ? e.message : "No pude generar la lectura ahora."
      if (!(e instanceof PaymentRequiredError)) console.error("[insights]", e)
      bullets = cached?.bullets ?? []
    }
  }
  return { ...report, bullets, aiError }
})
