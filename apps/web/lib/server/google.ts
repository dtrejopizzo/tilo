// Google: incremental consent on top of "Sign in with Google" for Gmail insights, Calendar and
// Google Health (Fitbit / Pixel Watch data). One connection per Google account; scopes accumulate.
import type { IngestPayload } from "@tilo/core/apiTypes"
import { env } from "../env"
import { supabaseAdmin } from "../supabase/server"
import { PaymentRequiredError } from "./apiRoute"
import { replyFollowUp, triageEmails, type EmailForTriage } from "./ai"
import { listConnections, loadScopedToken, loadTokens, makeState, markSynced, saveConnection, saveScopedToken, saveTokens } from "./connections"
import { ingest } from "./ingest"
import { ServerTiloApi } from "./tiloServer"

export type GoogleFeature = "gmail" | "calendar" | "health"

export const GOOGLE_SCOPES: Record<GoogleFeature, string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  health: [
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  ],
}

export function hasFeature(scopes: string[], feature: GoogleFeature) {
  return GOOGLE_SCOPES[feature].every((s) => scopes.includes(s))
}

// email: preselect that Google account. null: show the account chooser (connecting a second account).
export function googleAuthorizeUrl(userId: string, features: GoogleFeature[], email?: string | null, returnTo = "/"): string {
  const scope = ["openid", "email", "profile", ...features.flatMap((f) => GOOGLE_SCOPES[f])].join(" ")
  const params = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: `${env.appUrl()}/api/connect/google/callback`,
    response_type: "code",
    scope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: email ? "consent" : "select_account consent",
    state: makeState(userId, { r: returnTo }),
    ...(email ? { login_hint: email } : {}),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId(), client_secret: env.googleClientSecret(), ...body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Google token: ${data.error_description ?? data.error ?? res.status}`)
  return data as { access_token: string; refresh_token?: string; expires_in: number; scope: string }
}

export async function connectGoogle(userId: string, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: `${env.appUrl()}/api/connect/google/callback` })
  const info = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).json()
  const scopes = t.scope.split(" ")
  await saveConnection(
    userId,
    "google",
    info.sub,
    { accountEmail: info.email, displayName: info.name, scopes },
    { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: new Date(Date.now() + t.expires_in * 1000) },
  )
  return { sub: info.sub as string, scopes }
}

export async function googleToken(userId: string, sub: string): Promise<string> {
  const tokens = await loadTokens(userId, "google", sub)
  if (!tokens) throw new Error("Google not connected")
  if (tokens.expiresAt && tokens.expiresAt.getTime() > Date.now() + 120_000) return tokens.accessToken
  if (!tokens.refreshToken) throw new Error("invalid_grant: reconnect Google")
  const t = await tokenRequest({ refresh_token: tokens.refreshToken, grant_type: "refresh_token" })
  await saveTokens(userId, "google", sub, { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: new Date(Date.now() + t.expires_in * 1000) })
  return t.access_token
}

// Google Health rejects tokens that also carry Gmail or Calendar scopes (DISALLOWED_OAUTH_SCOPES).
// The connection holds one refresh token with every scope, so mint a down-scoped access token
// with only the health scopes. It isn't stored, so the main token keeps Gmail and Calendar.
export async function googleHealthToken(userId: string, sub: string): Promise<string> {
  const cached = await loadScopedToken(userId, "google", sub)
  if (cached) return cached
  const tokens = await loadTokens(userId, "google", sub)
  if (!tokens) throw new Error("Google not connected")
  if (!tokens.refreshToken) throw new Error("invalid_grant: reconnect Google")
  const t = await tokenRequest({ refresh_token: tokens.refreshToken, grant_type: "refresh_token", scope: GOOGLE_SCOPES.health.join(" ") })
  await saveScopedToken(userId, "google", sub, t.access_token, new Date(Date.now() + t.expires_in * 1000)).catch(() => {})
  return t.access_token
}

// Google Health's own id for the person: webhook notifications carry it instead of the Google sub
export async function ensureHealthUserId(userId: string, sub: string, token: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("connections").select("health_user_id").eq("user_id", userId).eq("provider", "google").eq("external_id", sub).maybeSingle()
  if (data?.health_user_id) return data.health_user_id
  const r = await gget<{ healthUserId?: string }>(token, `${HEALTH_ROOT}/users/me/identity`).catch(() => null)
  if (!r?.healthUserId) return null
  await supabaseAdmin().from("connections").update({ health_user_id: r.healthUserId }).eq("user_id", userId).eq("provider", "google").eq("external_id", sub)
  return r.healthUserId
}

async function gget<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Google ${new URL(url).pathname}: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300))
  return res.json() as Promise<T>
}

// ---------- Gmail ----------

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"

interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: { headers?: { name: string; value: string }[] }
}

const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""

function senderName(from: string) {
  return from.replace(/<.*>/, "").replace(/"/g, "").trim() || from
}

async function listIds(token: string, q: string, max = 200): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const r = await gget<{ messages?: { id: string }[]; nextPageToken?: string }>(
      token,
      `${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
    )
    ids.push(...(r.messages ?? []).map((m) => m.id))
    pageToken = r.nextPageToken
  } while (pageToken && ids.length < max)
  return ids.slice(0, max)
}

async function metadata(token: string, ids: string[]): Promise<GmailMessage[]> {
  const out: GmailMessage[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = await Promise.all(
      ids.slice(i, i + 20).map((id) =>
        gget<GmailMessage>(token, `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe&metadataHeaders=Date`).catch(() => null),
      ),
    )
    out.push(...(chunk.filter(Boolean) as GmailMessage[]))
  }
  return out
}

const isNewsletter = (m: GmailMessage) =>
  !!header(m, "List-Unsubscribe") || (m.labelIds ?? []).some((l) => ["CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(l))

// Daily inbox snapshot (counts and metadata only, never message bodies) + important-email triage
export async function gmailSnapshot(userId: string, sub: string, accountEmail: string, date: string, today: string) {
  const token = await googleToken(userId, sub)
  const inbox = await gget<{ messagesTotal: number; messagesUnread: number }>(token, `${GMAIL}/labels/INBOX`)
  const [receivedIds, sentIds] = await Promise.all([listIds(token, "newer_than:1d -in:sent -in:chats", 300), listIds(token, "in:sent newer_than:1d", 300)])
  const received = await metadata(token, receivedIds.slice(0, 150))
  const promotions = received.filter((m) => (m.labelIds ?? []).includes("CATEGORY_PROMOTIONS")).length
  const newsletters = received.filter(isNewsletter)
  const personal = received.filter((m) => !isNewsletter(m))

  const senders = new Map<string, { sender: string; count: number; unopened: number; unsubscribe?: string }>()
  for (const m of newsletters) {
    const s = senderName(header(m, "From"))
    const e = senders.get(s) ?? { sender: s, count: 0, unopened: 0, unsubscribe: header(m, "List-Unsubscribe").match(/<(https?:[^>]+)>/)?.[1] }
    e.count++
    if ((m.labelIds ?? []).includes("UNREAD")) e.unopened++
    senders.set(s, e)
  }

  await supabaseAdmin().from("email_snapshots").upsert(
    {
      user_id: userId, date, account_email: accountEmail, inbox_total: inbox.messagesTotal, unread: inbox.messagesUnread,
      received: receivedIds.length, sent: sentIds.length, personal: personal.length, newsletters: newsletters.length, promotions,
      top_senders: [...senders.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    },
    { onConflict: "user_id,date,account_email" },
  )

  await triageInbox(userId, token, accountEmail, personal.filter((m) => (m.labelIds ?? []).includes("INBOX")).slice(0, 40), today)
}

// Mails from people that wait for an answer (or carry a date) become tasks on their own, tagged with
// the account they came from. Runs on every message not triaged before; idempotent on retries.
async function triageInbox(userId: string, token: string, accountEmail: string, inboxPersonal: GmailMessage[], today: string) {
  if (!inboxPersonal.length) return 0
  const db = supabaseAdmin()
  const { data: seen } = await db.from("email_insights").select("message_id").eq("user_id", userId).in("message_id", inboxPersonal.map((m) => m.id))
  const fresh = inboxPersonal.filter((m) => !(seen ?? []).some((s) => s.message_id === m.id))
  if (!fresh.length) return 0
  const emails: EmailForTriage[] = fresh.map((m) => ({
    id: m.id, from: header(m, "From"), subject: header(m, "Subject"), snippet: m.snippet ?? "",
    date: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
  }))
  let results: { id: string; category: "reply" | "deadline" | "fyi"; due_date?: string | null }[]
  try {
    results = await triageEmails(userId, emails, today)
  } catch (e) {
    if (!(e instanceof PaymentRequiredError)) throw e
    // No AI available: questions and replies from people count as "reply"
    results = emails.filter((e) => /^re:|\?/i.test(e.subject)).map((e) => ({ id: e.id, category: "reply" as const }))
  }
  const api = new ServerTiloApi(userId)
  let created = 0
  for (const r of results) {
    const e = emails.find((x) => x.id === r.id)
    if (!e) continue
    const m = fresh.find((x) => x.id === e.id)!
    const dueDate = r.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) ? r.due_date : null
    const from = senderName(e.from)
    let taskId: string | null = null
    if (r.category === "reply" || r.category === "deadline") {
      // Every message in a thread is triaged, but a conversation is one task: reuse the open one
      const { data: existing } = m.threadId
        ? await db.from("tasks").select("id").eq("user_id", userId).eq("source", "email").eq("status", "todo").eq("source_ref->>thread_id", m.threadId).limit(1).maybeSingle()
        : { data: null }
      if (existing) {
        await db.from("email_insights").upsert(
          { user_id: userId, account_email: accountEmail, message_id: e.id, thread_id: m.threadId ?? null, received_at: e.date, from_name: from, subject: e.subject.slice(0, 300), category: r.category, due_date: dueDate, task_id: existing.id },
          { onConflict: "user_id,message_id", ignoreDuplicates: true },
        )
        continue
      }
      const soon = dueDate != null && Date.parse(dueDate) - Date.parse(today) <= 3 * 86_400_000
      const t = await api
        .addTask({
          title: (r.category === "reply" ? `Responder a ${from}: ${e.subject}` : e.subject || `Mail de ${from}`).slice(0, 300),
          due_date: dueDate ?? (r.category === "reply" ? today : undefined),
          priority: soon ? "high" : "medium",
          source: "email",
          // since: only a reply sent after this mail closes the task
          source_ref: { message_id: e.id, thread_id: m.threadId ?? null, account: accountEmail, from, since: Number(m.internalDate ?? Date.now()) },
        })
        .catch((err) => {
          console.error("[gmail] task from mail:", err)
          return null
        })
      taskId = t?.id ?? null
      if (taskId) created++
    }
    await db.from("email_insights").upsert(
      {
        user_id: userId, account_email: accountEmail, message_id: e.id, thread_id: m.threadId ?? null, received_at: e.date, from_name: from,
        subject: e.subject.slice(0, 300), category: r.category, due_date: dueDate, task_id: taskId,
      },
      { onConflict: "user_id,message_id", ignoreDuplicates: true },
    )
  }
  return created
}

// The text the person wrote in a sent message, without the quoted thread below it
function replyText(payload: GmailPart | undefined): string {
  const find = (p: GmailPart | undefined): string | null => {
    if (!p) return null
    if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8")
    for (const c of p.parts ?? []) {
      const t = find(c)
      if (t) return t
    }
    return null
  }
  let text = find(payload)
  if (!text) {
    const html = (function h(p: GmailPart | undefined): string | null {
      if (!p) return null
      if (p.mimeType === "text/html" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8")
      for (const c of p.parts ?? []) { const t = h(c); if (t) return t }
      return null
    })(payload)
    text = html ? html.replace(/<blockquote[\s\S]*$/i, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : ""
  }
  // Cut at the quoted history: "El jue, 15 oct … escribió:", "On … wrote:", "-----Original Message-----", "> …"
  const cut = text.search(/\n(El .{5,120}escribi[óo]:|On .{5,160}wrote:|-{3,}\s*(Original Message|Mensaje original)|From: .+\n)|\n>/i)
  return (cut > 0 ? text.slice(0, cut) : text).replace(/\s+\n/g, "\n").trim()
}

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }

// Open tasks that came from a mail: if the person answered after that mail, close them. If the
// answer promises more ("te lo mando mañana"), that promise becomes the next task on the thread.
async function closeAnsweredMailTasks(userId: string, token: string, accountEmail: string, today: string) {
  const db = supabaseAdmin()
  const { data: open } = await db.from("tasks").select("id, title, project_id, source_ref").eq("user_id", userId).eq("source", "email").eq("status", "todo")
  const mine = (open ?? []).filter((t) => {
    const ref = t.source_ref as { account?: string; thread_id?: string } | null
    return ref?.thread_id && (!ref.account || ref.account === accountEmail)
  })
  let closed = 0
  for (const t of mine) {
    const ref = t.source_ref as { thread_id: string; since?: number; from?: string; account?: string }
    const thread = await gget<{ messages?: { id: string; labelIds?: string[]; internalDate?: string }[] }>(token, `${GMAIL}/threads/${ref.thread_id}?format=minimal`).catch(() => null)
    const sent = (thread?.messages ?? []).filter((m) => (m.labelIds ?? []).includes("SENT") && Number(m.internalDate ?? 0) > (ref.since ?? 0)).at(-1)
    if (!sent) continue

    // Read what the person wrote and look for a promise before closing: if the AI is down for a
    // moment the task stays open and the next pass tries again, so no promise gets lost
    let follow: Awaited<ReturnType<typeof replyFollowUp>> = null
    try {
      const full = await gget<{ payload?: GmailPart; internalDate?: string }>(token, `${GMAIL}/messages/${sent.id}?format=full`)
      const body = replyText(full.payload)
      const hdr = (n: string) => full.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? ""
      if (body.length >= 3) follow = await replyFollowUp(userId, { to: hdr("to"), subject: hdr("subject"), body, date: new Date(Number(full.internalDate ?? Date.now())).toISOString() }, today)
    } catch (e) {
      if (!(e instanceof PaymentRequiredError)) {
        console.error("[gmail] follow-up, retrying next pass:", e)
        continue
      }
    }
    await db.from("tasks").update({ status: "done", completed_on: today }).eq("id", t.id).eq("user_id", userId)
    await db.from("email_insights").update({ replied_at: new Date(Number(sent.internalDate ?? Date.now())).toISOString(), dismissed: true }).eq("user_id", userId).eq("task_id", t.id)
    closed++
    if (follow) {
      await new ServerTiloApi(userId).addTask({
        title: follow.title,
        due_date: follow.due_date ?? today,
        priority: "medium",
        source: "email",
        // Same thread; only a reply sent after this one closes it
        source_ref: { thread_id: ref.thread_id, account: ref.account ?? accountEmail, from: ref.from, since: Number(sent.internalDate ?? Date.now()), follow_up_of: t.id },
      })
    }
  }
  return closed
}

// The frequent pass (every 15 minutes): new personal mail → tasks, answered threads → done.
// Much lighter than gmailSnapshot: one list of the last two days plus one request per open mail task.
export async function gmailInboxCheck(userId: string, sub: string, accountEmail: string, today: string) {
  const token = await googleToken(userId, sub)
  const ids = await listIds(token, "in:inbox -in:sent -in:chats newer_than:2d", 60)
  const inbox = (await metadata(token, ids)).filter((m) => !isNewsletter(m))
  const [created, closed] = await Promise.all([triageInbox(userId, token, accountEmail, inbox, today), closeAnsweredMailTasks(userId, token, accountEmail, today)])
  return { created, closed }
}

// ---------- Calendar ----------

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  meetLink: string | null
  account: string
}

export async function calendarEvents(userId: string, date: string, timezone: string): Promise<CalendarEvent[]> {
  const conns = (await listConnections("google", userId)).filter((c) => hasFeature(c.scopes, "calendar"))
  const all = await Promise.all(
    conns.map(async (c) => {
      const token = await googleToken(userId, c.external_id)
      const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      const params = new URLSearchParams({
        timeMin: `${date}T00:00:00Z`, timeMax: `${next}T23:59:59Z`, singleEvents: "true", orderBy: "startTime", timeZone: timezone, maxResults: "50",
      })
      const r = await gget<{ items?: { id: string; summary?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; hangoutLink?: string; status?: string }[] }>(
        token,
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      )
      return (r.items ?? [])
        .filter((e) => e.status !== "cancelled")
        .map((e) => ({
          id: e.id, title: e.summary ?? "(sin título)", start: e.start.dateTime ?? e.start.date!, end: e.end.dateTime ?? e.end.date!,
          allDay: !e.start.dateTime, meetLink: e.hangoutLink ?? null, account: c.account_email ?? "",
        }))
    }),
  )
  const local = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
  return all.flat().filter((e) => (e.allDay ? e.start === date : local(e.start) === date)).sort((a, b) => a.start.localeCompare(b.start))
}

// ---------- Google Health (Fitbit / Pixel Watch) — beta ----------
// POST https://health.googleapis.com/v4/users/me/dataTypes/{type}/dataPoints:dailyRollUp
// Field names inside rollup values are parsed defensively (first numeric leaf) until verified
// against live responses.

const HEALTH_ROOT = "https://health.googleapis.com/v4"
const HEALTH = `${HEALTH_ROOT}/users/me/dataTypes`

function firstNumber(obj: unknown, prefer: RegExp): number | null {
  const found: [string, number][] = []
  const walk = (o: unknown, path: string) => {
    if (typeof o === "number") found.push([path, o])
    else if (typeof o === "string" && /^-?\d+(\.\d+)?$/.test(o)) found.push([path, Number(o)])
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
  }
  walk(obj, "")
  return (found.find(([p]) => prefer.test(p)) ?? found[0])?.[1] ?? null
}

function civil(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return { date: { year, month, day } }
}

async function rollup(token: string, type: string, from: string, toExclusive: string) {
  const res = await fetch(`${HEALTH}/${type}/dataPoints:dailyRollUp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range: { start: civil(from), end: civil(toExclusive) }, windowSizeDays: 1 }),
  })
  if (!res.ok) throw new Error(`Google Health ${type}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { rollupDataPoints?: { civilStartTime?: { date?: { year: number; month: number; day: number } } }[] }
  return (data.rollupDataPoints ?? []).map((p) => {
    const d = p.civilStartTime?.date
    const date = d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null
    const { civilStartTime, civilEndTime, ...value } = p as Record<string, unknown>
    void civilStartTime
    void civilEndTime
    return { date, value }
  })
}

// Sample / session types (weight, body fat, height, sleep) have no daily rollup: list the raw points.
// GET /users/me/dataTypes/{type}/dataPoints?filter=<AIP-160 on the type's time field>
async function listPoints(token: string, type: string, filter: string, pageSize = 200): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ filter, pageSize: String(pageSize), ...(pageToken ? { pageToken } : {}) })
    const res = await fetch(`${HEALTH}/${type}/dataPoints?${q}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Google Health ${type}: ${res.status} ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as { dataPoints?: Record<string, unknown>[]; nextPageToken?: string }
    out.push(...(data.dataPoints ?? []))
    pageToken = data.nextPageToken || undefined
    if (!pageToken) break
  }
  return out
}

// Local date of a sample: civilTime if Google provides it, else the physical timestamp's date
function sampleDate(point: Record<string, unknown>, key: string): string | null {
  const inner = point[key] as Record<string, unknown> | undefined
  const st = (inner?.sampleTime ?? inner?.interval) as Record<string, unknown> | undefined
  const civil = (st?.civilTime ?? st?.civilEndTime ?? st?.civilStartTime) as { date?: { year: number; month: number; day: number } } | undefined
  if (civil?.date) return `${civil.date.year}-${String(civil.date.month).padStart(2, "0")}-${String(civil.date.day).padStart(2, "0")}`
  const ts = (st?.physicalTime ?? st?.endTime ?? st?.startTime) as string | undefined
  return ts ? ts.slice(0, 10) : null
}

// Weight, body fat, height and sleep from Google Health (smart scales, Fitbit, Pixel Watch, apps that write to Health Connect)
async function syncGoogleBody(userId: string, token: string, from: string, to: string, set: (date: string | null, key: string, v: number | null) => void) {
  const weights = new Map<string, { kg: number; body_fat_pct?: number }>()
  const [weight, fat, height, sleep] = await Promise.all([
    listPoints(token, "weight", `weight.sample_time.physical_time >= "${from}T00:00:00Z" AND weight.sample_time.physical_time < "${to}T00:00:00Z"`).catch(() => []),
    listPoints(token, "body-fat", `body_fat.sample_time.physical_time >= "${from}T00:00:00Z" AND body_fat.sample_time.physical_time < "${to}T00:00:00Z"`).catch(() => []),
    listPoints(token, "height", `height.sample_time.physical_time >= "2000-01-01T00:00:00Z"`, 5).catch(() => []),
    listPoints(token, "sleep", `sleep.interval.end_time >= "${from}T00:00:00Z" AND sleep.interval.end_time < "${to}T23:59:59Z"`, 100).catch(() => []),
  ])
  // Points come newest first: keep the latest sample of each day
  for (const p of weight) {
    const date = sampleDate(p, "weight")
    const grams = firstNumber(p.weight, /grams/i)
    if (date && grams != null && !weights.has(date)) weights.set(date, { kg: grams / 1000 })
  }
  for (const p of fat) {
    const date = sampleDate(p, "bodyFat")
    const pct = firstNumber(p.bodyFat, /percent/i)
    const w = date ? weights.get(date) : undefined
    if (w && pct != null && w.body_fat_pct == null) w.body_fat_pct = pct
  }
  // Sleep sessions: minutes asleep per night, credited to the day the person woke up
  const sleepByDate = new Map<string, number>()
  for (const p of sleep) {
    const s = p.sleep as Record<string, unknown> | undefined
    const date = sampleDate(p, "sleep")
    const summary = s?.summary as Record<string, unknown> | undefined
    let minutes = firstNumber(summary, /minutesAsleep/i)
    if (minutes == null) {
      const iv = s?.interval as { startTime?: string; endTime?: string } | undefined
      if (iv?.startTime && iv.endTime) minutes = Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60_000)
    }
    if (date && minutes != null && minutes > 0) sleepByDate.set(date, (sleepByDate.get(date) ?? 0) + minutes)
  }
  for (const [date, min] of sleepByDate) set(date, "sleep_min", min)
  // Height: fill the profile when the person hasn't typed one
  const mm = height.length ? firstNumber(height[0].height, /millimeters/i) : null
  if (mm != null && mm > 800) {
    const { data } = await supabaseAdmin().from("profiles").select("height_cm").eq("id", userId).single()
    if (data && data.height_cm == null) await supabaseAdmin().from("profiles").update({ height_cm: Math.round(mm / 10) }).eq("id", userId)
  }
  return [...weights].map(([date, w]) => ({ date, ...w }))
}

const ROLLUP_TYPES = ["steps", "distance", "active-energy-burned", "daily-resting-heart-rate"] as const

// Daily rollups in 30-day chunks, so a backfill of months stays within the API's range limits.
// Throws only if every request failed (e.g. API disabled, bad scopes) so the error reaches last_error.
async function rollups(token: string, from: string, to: string) {
  const chunks: [string, string][] = []
  for (let a = from; a < to; ) {
    const b = new Date(Math.min(Date.parse(`${a}T00:00:00Z`) + 30 * 86_400_000, Date.parse(`${to}T00:00:00Z`))).toISOString().slice(0, 10)
    chunks.push([a, b])
    a = b
  }
  const out: Record<string, Awaited<ReturnType<typeof rollup>>> = {}
  const errors: unknown[] = []
  let ok = 0
  // Every type and chunk at once (the per-user limit is 300 requests a minute; this is a handful)
  await Promise.all(
    ROLLUP_TYPES.map(async (type) => {
      out[type] = []
      const results = await Promise.allSettled(chunks.map(([a, b]) => rollup(token, type, a, b)))
      for (const r of results) {
        if (r.status === "fulfilled") {
          out[type].push(...r.value)
          ok++
        } else errors.push(r.reason)
      }
    }),
  )
  if (ok === 0 && errors.length) throw errors[0]
  for (const e of errors.slice(0, 3)) console.error("[google health]", e)
  return out
}

// Parses a protobuf Duration string ("1234.5s") into whole seconds
const seconds = (d: unknown) => (typeof d === "string" && /^\d+(\.\d+)?s$/.test(d) ? Math.round(Number(d.slice(0, -1))) : null)

// Exercise sessions (Pixel Watch, Fitbit, and anything an app wrote to Health Connect, e.g. Strava)
// become activities; sessions also recorded by Strava are merged by time overlap in ingest().
async function syncGoogleExercise(token: string, from: string, to: string): Promise<NonNullable<IngestPayload["activities"]>> {
  // Sessions filter on civil (local) time without an offset, unlike samples which use physical_time
  const points = await listPoints(token, "exercise", `exercise.interval.civil_start_time >= "${from}T00:00:00" AND exercise.interval.civil_start_time < "${to}T00:00:00"`, 25)
  const out: NonNullable<IngestPayload["activities"]> = []
  // Until the response shape is confirmed against real data: say what came back if nothing parses
  const unparsed = () => new Error(`${points.length} sesiones recibidas, ninguna con interval.startTime/endTime; claves: ${Object.keys(points[0] ?? {}).join(",")} / ${Object.keys((points[0]?.exercise as object) ?? {}).join(",")}`.slice(0, 220))
  for (const p of points) {
    const ex = p.exercise as Record<string, unknown> | undefined
    const iv = ex?.interval as { startTime?: string; endTime?: string } | undefined
    if (!iv?.startTime || !iv.endTime) continue
    const m = (ex?.metricsSummary ?? {}) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null)
    const name = String(p.name ?? "")
    const id = name.split("/").pop() || `${iv.startTime}`
    out.push({
      external_id: id,
      type: String(ex?.exerciseType ?? "other").toLowerCase().replace(/_/g, " "),
      name: typeof ex?.displayName === "string" ? ex.displayName : undefined,
      start_at: iv.startTime,
      end_at: iv.endTime,
      duration_s: seconds(ex?.activeDuration) ?? undefined,
      distance_m: num(m.distanceMillimeters) != null ? num(m.distanceMillimeters)! / 1000 : undefined,
      kcal: num(m.caloriesKcal) ?? undefined,
      kcal_is_net: false,
      avg_hr: num(m.averageHeartRateBeatsPerMinute) ?? undefined,
      steps: num(m.steps) ?? undefined,
      elevation_m: num(m.elevationGainMillimeters) != null ? num(m.elevationGainMillimeters)! / 1000 : undefined,
      // What Google sent, to check field names against real data (no personal data beyond the workout itself)
      raw: { google: { exerciseType: ex?.exerciseType, metricsSummary: m, keys: Object.keys(ex ?? {}) } },
    })
  }
  if (points.length && !out.length) throw unparsed()
  return out
}

export async function syncGoogleHealth(userId: string, sub: string, days = 3) {
  try {
    const token = await googleHealthToken(userId, sub)
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const byDate = new Map<string, Record<string, number | string>>()
    const set = (date: string | null, key: string, v: number | null) => {
      if (!date || v == null) return
      byDate.set(date, { ...(byDate.get(date) ?? { date }), [key]: v })
    }
    // Rollups, sessions and body metrics in parallel; the identity lookup is a one-time extra
    let note: string | null = null // non-fatal problems, shown next to the connection in Settings
    const [r0, activities, weights] = await Promise.all([
      rollups(token, from, to),
      syncGoogleExercise(token, from, to).catch((e) => {
        console.error("[google health] exercise:", e)
        note = `aviso, sesiones de ejercicio: ${String(e).slice(0, 200)}`
        return []
      }),
      syncGoogleBody(userId, token, from, to, set).catch((e) => {
        console.error("[google health] body metrics:", e)
        return []
      }),
      ensureHealthUserId(userId, sub, token).catch(() => null),
    ])
    const [steps, distance, active, resting] = ROLLUP_TYPES.map((t) => r0[t])
    for (const p of steps) set(p.date, "steps", firstNumber(p.value, /count|sum/i))
    for (const p of distance) {
      const v = firstNumber(p.value, /meters|millimeters|sum/i)
      set(p.date, "distance_m", v != null && /millimeters/i.test(JSON.stringify(p.value)) ? v / 1000 : v)
    }
    for (const p of active) set(p.date, "active_kcal", firstNumber(p.value, /kcal|kilocalories|sum/i))
    for (const p of resting) set(p.date, "resting_hr", firstNumber(p.value, /beatsPerMinute|avg|min/i))
    const payload: IngestPayload = { source: "google_health", device: "Google Health", daily: [...byDate.values()] as IngestPayload["daily"], activities, weights }
    const r = await ingest(userId, payload)
    await markSynced(userId, "google", sub)
    if (note) await supabaseAdmin().from("connections").update({ last_error: note }).eq("user_id", userId).eq("provider", "google").eq("external_id", sub)
    return r
  } catch (error) {
    await markSynced(userId, "google", sub, String(error))
    throw error
  }
}
