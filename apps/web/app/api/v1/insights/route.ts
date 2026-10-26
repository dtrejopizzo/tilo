import { createHash } from "node:crypto"
import { buildProgress } from "@tilo/core/progress"
import { apiRoute, parseDate, PaymentRequiredError } from "@/lib/server/apiRoute"
import { readProgress } from "@/lib/server/ai"
import { calendarEvents } from "@/lib/server/google"
import { ServerTiloApi } from "@/lib/server/tiloServer"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const MIN_GAP_MS = 10 * 60_000 // never more often than this
const MAX_AGE_MS = 3 * 3600_000 // and refresh at least this often (the time of day changes the advice)

// GET ?date= → the day's panorama: four lines from the better AI model, regenerated when the data
// behind them changes (meals, water, sessions, sleep…), cached in settings in between
export const GET = apiRoute(async ({ uid, req }) => {
  const today = parseDate(req.nextUrl.searchParams.get("date"))
  const range = await new ServerTiloApi(uid).getRange(addDays(today, -20), today)
  const report = buildProgress(range, today)

  const db = supabaseAdmin()
  const [{ data: row }, { data: profile }] = await Promise.all([
    db.from("settings").select("data").eq("user_id", uid).maybeSingle(),
    db.from("profiles").select("timezone, sex").eq("id", uid).single(),
  ])
  const data = (row?.data ?? {}) as Record<string, unknown>
  const cached = data.insights_cache as { date: string; at: number; bullets: string[]; fp?: string } | undefined
  const fp = createHash("sha1").update(JSON.stringify(report.facts)).digest("hex").slice(0, 16)
  const age = cached ? Date.now() - cached.at : Infinity
  const stale = !cached || cached.date !== today || age > MAX_AGE_MS || (cached.fp !== fp && age > MIN_GAP_MS)
  let bullets = cached?.date === today ? cached.bullets : []
  let aiError: string | null = null

  if (stale || req.nextUrl.searchParams.get("refresh") === "1") {
    const tz = profile?.timezone ?? "America/Argentina/Buenos_Aires"
    const localTime = new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date())
    // What's left on today's calendar, once (the same event can sit in two accounts), without
    // all-day blocks or the ones the person hid. Mixes meetings and personal routine blocks.
    const hidden = ((data.hidden_events as string[] | undefined) ?? []).map((h) => h.trim().toLowerCase())
    const hhmm = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
    const schedule = await calendarEvents(uid, today, tz)
      .then((events) => [...new Map(events
        .filter((x) => !x.allDay && !hidden.includes(x.title.trim().toLowerCase()) && Date.parse(x.end) > Date.now())
        .map((x) => [`${x.title.trim().toLowerCase()}|${x.start}`, `${hhmm(x.start)} ${x.title.trim()}`])).values()])
      .catch(() => null)
    try {
      bullets = await readProgress(uid, { ...report.facts, schedule_rest_of_today: schedule, sex: profile?.sex ?? null }, today, localTime, cached?.bullets ?? [])
      await db.from("settings").upsert({ user_id: uid, data: { ...data, insights_cache: { date: today, at: Date.now(), bullets, fp } }, updated_at: new Date().toISOString() })
    } catch (e) {
      aiError = e instanceof PaymentRequiredError ? e.message : "No pude generar el panorama ahora."
      if (!(e instanceof PaymentRequiredError)) console.error("[insights]", e)
      // Keep the reason next to the cache so it can be read without the logs
      await db.from("settings").upsert({ user_id: uid, data: { ...data, insights_error: { at: new Date().toISOString(), error: String((e as Error)?.message ?? e).slice(0, 600) } }, updated_at: new Date().toISOString() })
    }
  }
  return { ...report, bullets, aiError, generatedAt: cached && !stale ? cached.at : Date.now() }
})
