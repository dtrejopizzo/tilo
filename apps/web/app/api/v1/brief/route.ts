import { createHash } from "node:crypto"
import { buildProgress } from "@tilo/core/progress"
import { apiRoute, parseDate, PaymentRequiredError } from "@/lib/server/apiRoute"
import { readBrief } from "@/lib/server/ai"
import { calendarEvents } from "@/lib/server/google"
import { ServerTiloApi } from "@/lib/server/tiloServer"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const MIN_GAP_MS = 10 * 60_000
const MAX_AGE_MS = 2 * 3600_000

// Most important open tasks first: overdue, high priority, due today, mail waiting for an answer
function rankTasks<T extends { status: string; due_date: string | null; priority: string; source: string }>(tasks: T[], today: string): T[] {
  const score = (t: T) =>
    (t.due_date && t.due_date < today ? 4 : 0) + (t.priority === "high" ? 3 : t.priority === "low" ? -1 : 0) + (t.due_date === today ? 2 : 0) + (t.source === "email" ? 1 : 0)
  return tasks.filter((t) => t.status === "todo" && (!t.due_date || t.due_date <= today)).sort((a, b) => score(b) - score(a))
}

// GET ?date= → Inicio: the day's real meetings, the top tasks and 2-3 lines on what to do now
export const GET = apiRoute(async ({ uid, req }) => {
  const today = parseDate(req.nextUrl.searchParams.get("date"))
  const api = new ServerTiloApi(uid)
  const db = supabaseAdmin()
  const [range, day, { data: row }, { data: profile }] = await Promise.all([
    api.getRange(addDays(today, -20), today),
    api.getDay(today),
    db.from("settings").select("data").eq("user_id", uid).maybeSingle(),
    db.from("profiles").select("timezone").eq("id", uid).single(),
  ])
  const tz = profile?.timezone ?? "America/Argentina/Buenos_Aires"
  const data = (row?.data ?? {}) as Record<string, unknown>
  const hidden = ((data.hidden_events as string[] | undefined) ?? []).map((h) => h.trim().toLowerCase())
  const hhmm = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))

  // Real meetings only, once even if they're on two calendars
  const events = await calendarEvents(uid, today, tz).catch(() => [])
  const meetings = [...new Map(events.filter((e) => e.meeting && !hidden.includes(e.title.trim().toLowerCase())).map((e) => [`${e.title.trim().toLowerCase()}|${e.start}`, e])).values()]
  const top = rankTasks(day.tasks, today).slice(0, 4)

  const report = buildProgress(range, today)
  const facts = {
    ...report.facts,
    meetings_left: meetings.filter((m) => Date.parse(m.end) > Date.now()).map((m) => `${hhmm(m.start)} ${m.title}`),
    top_tasks: top.map((t) => t.title),
  }
  const cached = data.brief_cache as { date: string; at: number; bullets: string[]; fp?: string } | undefined
  const fp = createHash("sha1").update(JSON.stringify(facts)).digest("hex").slice(0, 16)
  const age = cached ? Date.now() - cached.at : Infinity
  const stale = !cached || cached.date !== today || age > MAX_AGE_MS || (cached.fp !== fp && age > MIN_GAP_MS)
  let bullets = cached?.date === today ? cached.bullets : []
  let aiError: string | null = null
  if (stale || req.nextUrl.searchParams.get("refresh") === "1") {
    const localTime = new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date())
    try {
      bullets = await readBrief(uid, facts, today, localTime)
      await db.from("settings").upsert({ user_id: uid, data: { ...data, brief_cache: { date: today, at: Date.now(), bullets, fp } }, updated_at: new Date().toISOString() })
    } catch (e) {
      aiError = e instanceof PaymentRequiredError ? e.message : "No pude armar tu día ahora."
      if (!(e instanceof PaymentRequiredError)) console.error("[brief]", e)
    }
  }
  return { bullets, aiError, meetings, tasks: top }
})
