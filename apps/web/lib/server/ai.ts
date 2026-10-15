import { GoogleGenAI } from "@google/genai"
import { env } from "../env"
import { supabaseAdmin } from "../supabase/server"
import { PaymentRequiredError } from "./apiRoute"
import { decrypt } from "./crypto"

// Tilo's own AI (Gemini, paid tier: user data is never used for training) is available during the
// 7-day trial and on Pro, with a daily cap. Anyone can bring their own key (Gemini, OpenAI or
// Anthropic), and MCP clients (Claude, ChatGPT, Copilot, Gemini CLI) use the user's own model for free.

type Provider = "gemini" | "openai" | "anthropic"

interface AiCredentials {
  provider: Provider
  apiKey: string
  model: string
  own: boolean // user's own key: no metering cap
}

const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: "gemini-3.8-flash",
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5-20251001",
}

const PRO_DAILY_REQUESTS = 300

export const AI_UPSELL =
  "Tu prueba de IA terminó. Pasá a Tilo Pro, cargá tu propia API key en Settings → IA, o registrá desde Claude/ChatGPT con el MCP de Tilo (gratis)."

async function credentialsFor(userId: string): Promise<AiCredentials> {
  const db = supabaseAdmin()
  const [{ data: profile }, { data: settings }] = await Promise.all([
    db.from("profiles").select("plan, trial_ends_at").eq("id", userId).single(),
    db.from("settings").select("data").eq("user_id", userId).maybeSingle(),
  ])
  const byok = (settings?.data as { ai?: { provider?: Provider; key_enc?: string; model?: string } } | null)?.ai
  if (byok?.provider && byok.key_enc) {
    return { provider: byok.provider, apiKey: decrypt(byok.key_enc), model: byok.model || DEFAULT_MODELS[byok.provider], own: true }
  }

  const trialActive = profile?.plan === "trial" && Date.parse(profile.trial_ends_at) > Date.now()
  if (profile?.plan !== "pro" && !trialActive) throw new PaymentRequiredError(AI_UPSELL)

  const key = env.geminiKey()
  if (!key) throw new Error("GEMINI_API_KEY is not set")

  const cap = profile?.plan === "pro" ? PRO_DAILY_REQUESTS : env.aiFreeDailyRequests()
  const today = new Date().toISOString().slice(0, 10)
  const { data: usage } = await db.from("ai_usage").select("requests").eq("user_id", userId).eq("date", today)
  const used = (usage ?? []).reduce((s, r) => s + r.requests, 0)
  if (used >= cap) {
    throw new PaymentRequiredError(
      profile?.plan === "pro"
        ? `Llegaste al límite diario de IA (${cap}). Vuelve mañana o cargá tu propia API key.`
        : `Llegaste al límite diario de IA de la prueba (${cap}). ${AI_UPSELL}`,
    )
  }
  return { provider: "gemini", apiKey: key, model: env.geminiModel(), own: false }
}

async function meter(userId: string, feature: string, input: number, output: number) {
  const db = supabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await db.from("ai_usage").select("requests, input_tokens, output_tokens").eq("user_id", userId).eq("date", today).eq("feature", feature).maybeSingle()
  await db.from("ai_usage").upsert(
    {
      user_id: userId, date: today, feature,
      requests: (data?.requests ?? 0) + 1,
      input_tokens: (data?.input_tokens ?? 0) + input,
      output_tokens: (data?.output_tokens ?? 0) + output,
    },
    { onConflict: "user_id,date,feature" },
  )
}

// Asks the configured model for JSON matching `shape` (described in the prompt) and parses it
export async function generateJson<T>(userId: string, feature: string, system: string, prompt: string): Promise<T> {
  const creds = await credentialsFor(userId)
  let text: string
  let inputTokens = 0
  let outputTokens = 0

  if (creds.provider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: creds.apiKey })
    const res = await ai.models.generateContent({
      model: creds.model,
      contents: prompt,
      config: { systemInstruction: system, responseMimeType: "application/json", temperature: 0 },
    })
    text = res.text ?? ""
    inputTokens = res.usageMetadata?.promptTokenCount ?? 0
    outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0
  } else if (creds.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: creds.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`OpenAI: ${data.error?.message ?? res.status}`)
    text = data.choices?.[0]?.message?.content ?? ""
    inputTokens = data.usage?.prompt_tokens ?? 0
    outputTokens = data.usage?.completion_tokens ?? 0
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": creds.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: creds.model,
        max_tokens: 2000,
        temperature: 0,
        system: `${system}\nRespond with a single JSON object and nothing else.`,
        messages: [{ role: "user", content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Anthropic: ${data.error?.message ?? res.status}`)
    text = data.content?.find((c: { type: string }) => c.type === "text")?.text ?? ""
    inputTokens = data.usage?.input_tokens ?? 0
    outputTokens = data.usage?.output_tokens ?? 0
  }

  if (!creds.own) await meter(userId, feature, inputTokens, outputTokens)
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  try {
    return JSON.parse(json) as T
  } catch {
    throw new Error(`The AI returned invalid JSON for ${feature}`)
  }
}

// ---------- Meals ----------

const MEAL_SYSTEM = `You are a precise clinical nutritionist. Estimate the nutrition of what the user ate.
Rules:
1. Respect explicit quantities exactly ("5 g de mantequilla de maní" = 5 g, not a serving).
2. Brands (e.g. "Bimbo", "Arcor", "La Serenísima") use that product's label values; otherwise USDA/FAO.
3. If no quantity is given, assume a standard serving and say so in "assumptions".
4. Assume cooked/edible state unless "crudo/raw" is said; add absorbed oil when fried.
5. Argentine/Spanish food names are common (milanesa, empanada, medialuna, mate, fernet, etc.).
6. Sum items exactly for the totals. Sanity-check the physics (5 g of butter can't have 10 g of fat).
Return JSON:
{"items":[{"name":string,"grams":number,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number}],
 "kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"alcohol_g":number,"caffeine_mg":number,
 "micros":{"sodium_mg":number,"potassium_mg":number,"calcium_mg":number,"iron_mg":number,"magnesium_mg":number,"vitamin_c_mg":number,"vitamin_a_mcg":number,"vitamin_d_iu":number,"vitamin_b12_mcg":number},
 "meal_type":"breakfast"|"morning_snack"|"lunch"|"merienda"|"afternoon_snack"|"dinner"|"snack","assumptions":string}`

export interface MealEstimate {
  items: { name: string; grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number }[]
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  alcohol_g: number
  caffeine_mg: number
  micros: Record<string, number>
  meal_type: "breakfast" | "morning_snack" | "lunch" | "merienda" | "afternoon_snack" | "dinner" | "snack"
  assumptions: string
}

export async function estimateMeal(userId: string, description: string, localTime?: string): Promise<MealEstimate> {
  const r = await generateJson<MealEstimate>(
    userId,
    "meal",
    MEAL_SYSTEM,
    `Meal: "${description}"${localTime ? `\nLocal time: ${localTime}` : ""}`,
  )
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : 0)
  return {
    items: Array.isArray(r.items) ? r.items.slice(0, 30) : [],
    kcal: n(r.kcal), protein_g: n(r.protein_g), carbs_g: n(r.carbs_g), fat_g: n(r.fat_g), fiber_g: n(r.fiber_g),
    alcohol_g: n(r.alcohol_g), caffeine_mg: n(r.caffeine_mg),
    micros: Object.fromEntries(Object.entries(r.micros ?? {}).filter(([, v]) => typeof v === "number" && v > 0)),
    meal_type: ["breakfast", "morning_snack", "lunch", "merienda", "afternoon_snack", "dinner", "snack"].includes(r.meal_type) ? r.meal_type : "snack",
    assumptions: typeof r.assumptions === "string" ? r.assumptions.slice(0, 300) : "",
  }
}

// ---------- Email ----------

export interface EmailForTriage {
  id: string
  from: string
  subject: string
  snippet: string
  date: string
}

// The person answered a mail. Did they promise something more ("te mando el doc mañana",
// "lo reviso y te contesto")? Then that promise is the next task.
export async function replyFollowUp(userId: string, reply: { to: string; subject: string; body: string; date: string }, today: string) {
  const r = await generateJson<{ follow_up: boolean; title?: string; due_date?: string | null }>(
    userId,
    "email",
    `You read a reply the user just sent. Decide if, in it, the user committed to a further action: send something later, answer properly later, review a document, schedule a call, pay, deliver, check with someone. Acknowledgements ("gracias", "recibido") and complete answers are not commitments.
If there is one, write the task the user now owes, in the language of the reply, starting with a verb and naming the person, e.g. "Enviar a Candice el informe actualizado" or "Responder en detalle a Candice sobre el fondo GOED". due_date: the date the user promised (YYYY-MM-DD), or null if none. Today is ${today}.
Return {"follow_up":boolean,"title":string|null,"due_date":string|null}.`,
    JSON.stringify({ to: reply.to, subject: reply.subject, sent_at: reply.date, body: reply.body.slice(0, 3000) }),
  )
  if (!r.follow_up || !r.title?.trim()) return null
  return { title: r.title.trim().slice(0, 300), due_date: r.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) ? r.due_date : null }
}

export async function triageEmails(userId: string, emails: EmailForTriage[], today: string) {
  if (!emails.length) return []
  const r = await generateJson<{ results: { id: string; category: "reply" | "deadline" | "fyi" | "none"; due_date?: string | null }[] }>(
    userId,
    "email",
    `You triage a person's inbox. For each email decide:
- "reply": a real person is waiting for an answer or decision from the user: clients, students, suppliers, colleagues, friends. This includes a person's message relayed by a platform (LinkedIn InMail or message notification, X/Twitter DM notification, WhatsApp/Slack/Discord digests quoting a specific person's message, marketplace buyer questions). Also a thread the user started where someone answered a question back.
- "deadline": there is a date the user must act by (payment, tax, renewal, appointment, delivery); set due_date YYYY-MM-DD
- "fyi": worth knowing but no action
- "none": automated, promotional, newsletters, notifications nobody wrote (likes, follows, "new login", receipts, calendar invites, shipping updates), out-of-office replies
Today is ${today}. Return {"results":[{"id":string,"category":string,"due_date":string|null}]}.`,
    JSON.stringify(emails.map((e) => ({ id: e.id, from: e.from, subject: e.subject, snippet: e.snippet.slice(0, 200), date: e.date }))),
  )
  return (r.results ?? []).filter(
    (x): x is { id: string; category: "reply" | "deadline" | "fyi"; due_date?: string | null } => x.category !== "none",
  )
}
