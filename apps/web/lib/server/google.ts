// Google: incremental consent on top of "Sign in with Google" for Gmail insights, Calendar and
// Google Health (Fitbit / Pixel Watch data). One connection per Google account; scopes accumulate.
import type { IngestPayload } from "@tilo/core/apiTypes"
import { env } from "../env"
import { supabaseAdmin } from "../supabase/server"
import { PaymentRequiredError } from "./apiRoute"
import { triageEmails, type EmailForTriage } from "./ai"
import { listConnections, loadTokens, makeState, markSynced, saveConnection, saveTokens } from "./connections"
import { ingest } from "./ingest"

export type GoogleFeature = "gmail" | "calendar" | "health"

export const GOOGLE_SCOPES: Record<GoogleFeature, string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  health: [
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  ],
}

export function hasFeature(scopes: string[], feature: GoogleFeature) {
  return GOOGLE_SCOPES[feature].every((s) => scopes.includes(s))
}

export function googleAuthorizeUrl(userId: string, features: GoogleFeature[], email?: string | null, returnTo = "/"): string {
  const scope = ["openid", "email", "profile", ...features.flatMap((f) => GOOGLE_SCOPES[f])].join(" ")
  const params = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: `${env.appUrl()}/api/connect/google/callback`,
    response_type: "code",
    scope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
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

async function gget<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Google ${new URL(url).pathname}: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300))
  return res.json() as Promise<T>
}

// ---------- Gmail ----------

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"

interface GmailMessage {
  id: string
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

  // Triage personal inbox mail not seen before
  const inboxPersonal = personal.filter((m) => (m.labelIds ?? []).includes("INBOX")).slice(0, 25)
  if (!inboxPersonal.length) return
  const { data: seen } = await supabaseAdmin().from("email_insights").select("message_id").eq("user_id", userId).in("message_id", inboxPersonal.map((m) => m.id))
  const fresh = inboxPersonal.filter((m) => !(seen ?? []).some((s) => s.message_id === m.id))
  if (!fresh.length) return
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
  const rows = results
    .map((r) => {
      const e = emails.find((x) => x.id === r.id)
      return e && {
        user_id: userId, account_email: accountEmail, message_id: e.id, received_at: e.date, from_name: senderName(e.from),
        subject: e.subject.slice(0, 300), category: r.category, due_date: r.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) ? r.due_date : null,
      }
    })
    .filter(Boolean)
  if (rows.length) await supabaseAdmin().from("email_insights").upsert(rows as object[], { onConflict: "user_id,message_id", ignoreDuplicates: true })
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

const HEALTH = "https://health.googleapis.com/v4/users/me/dataTypes"

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

export async function syncGoogleHealth(userId: string, sub: string, days = 3) {
  try {
    const token = await googleToken(userId, sub)
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const byDate = new Map<string, Record<string, number | string>>()
    const set = (date: string | null, key: string, v: number | null) => {
      if (!date || v == null) return
      byDate.set(date, { ...(byDate.get(date) ?? { date }), [key]: v })
    }
    const [steps, distance, active, resting] = await Promise.all([
      rollup(token, "steps", from, to).catch(() => []),
      rollup(token, "distance", from, to).catch(() => []),
      rollup(token, "active-energy-burned", from, to).catch(() => []),
      rollup(token, "daily-resting-heart-rate", from, to).catch(() => []),
    ])
    for (const p of steps) set(p.date, "steps", firstNumber(p.value, /count|sum/i))
    for (const p of distance) {
      const v = firstNumber(p.value, /meters|millimeters|sum/i)
      set(p.date, "distance_m", v != null && /millimeters/i.test(JSON.stringify(p.value)) ? v / 1000 : v)
    }
    for (const p of active) set(p.date, "active_kcal", firstNumber(p.value, /kcal|kilocalories|sum/i))
    for (const p of resting) set(p.date, "resting_hr", firstNumber(p.value, /beatsPerMinute|avg|min/i))
    const payload: IngestPayload = { source: "google_health", device: "Fitbit / Pixel Watch", daily: [...byDate.values()] as IngestPayload["daily"] }
    const r = await ingest(userId, payload)
    await markSynced(userId, "google", sub)
    return r
  } catch (error) {
    await markSynced(userId, "google", sub, String(error))
    throw error
  }
}
