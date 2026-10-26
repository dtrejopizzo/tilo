import { GoogleGenAI } from "@google/genai"
import { env } from "../env"
import { supabaseAdmin } from "../supabase/server"
import { PaymentRequiredError } from "./apiRoute"
import { decrypt } from "./crypto"

// Tilo's own AI goes through OpenRouter when OPENROUTER_API_KEY is set: a cheap model for the
// everyday work (mail triage, follow-ups, habit matching, insights) and a stronger one for meal
// macros, where accuracy is the product. Without it, Gemini directly. Anyone can bring their own
// key (Gemini, OpenAI or Anthropic), and MCP clients use the user's own model for free.

type Provider = "gemini" | "openai" | "anthropic" | "openrouter"

// Features that deserve the better model; everything else uses the cheap one
const QUALITY_FEATURES = new Set(["meal", "insights"])

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
  openrouter: "anthropic/claude-haiku-5.5",
}


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

  const openrouter = env.openrouterKey()
  const key = openrouter ?? env.geminiKey()
  if (!key) throw new Error("OPENROUTER_API_KEY or GEMINI_API_KEY must be set")
  const base = openrouter ? { provider: "openrouter" as const, apiKey: openrouter, model: env.aiModelCheap() } : { provider: "gemini" as const, apiKey: key, model: env.geminiModel() }

  const today = new Date().toISOString().slice(0, 10)
  if (profile?.plan === "pro") {
    // Pro: a monthly budget in dollars, from the tokens actually used this month
    const { data: month } = await db.from("ai_usage").select("input_tokens, output_tokens").eq("user_id", userId).gte("date", `${today.slice(0, 7)}-01`)
    const spent = (month ?? []).reduce((s, r) => s + (r.input_tokens * env.aiPriceInputPerM() + r.output_tokens * env.aiPriceOutputPerM()) / 1e6, 0)
    if (spent >= env.aiProMonthlyUsd()) {
      throw new PaymentRequiredError(`Llegaste al tope de IA de este mes (US$${env.aiProMonthlyUsd()}). Se renueva el 1°, o cargá tu propia API key en Settings → IA.`)
    }
    return { ...base, own: false }
  }
  const cap = env.aiFreeDailyRequests()
  const { data: usage } = await db.from("ai_usage").select("requests").eq("user_id", userId).eq("date", today)
  const used = (usage ?? []).reduce((s, r) => s + r.requests, 0)
  if (used >= cap) {
    throw new PaymentRequiredError(`Llegaste al límite diario de IA de la prueba (${cap}). ${AI_UPSELL}`)
  }
  return { ...base, own: false }
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
const GEMINI_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"]

export async function generateJson<T>(userId: string, feature: string, system: string, prompt: string): Promise<T> {
  const creds = await credentialsFor(userId)
  if (creds.provider === "openrouter" && QUALITY_FEATURES.has(feature)) creds.model = env.aiModelQuality()
  let text: string
  let inputTokens = 0
  let outputTokens = 0

  if (creds.provider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: creds.apiKey })
    // Each Gemini model has its own daily quota: when one is used up (429), fall back to the lite ones
    const models = [creds.model, ...GEMINI_FALLBACKS.filter((m) => m !== creds.model)]
    let res: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined
    for (const [i, model] of models.entries()) {
      try {
        res = await ai.models.generateContent({ model, contents: prompt, config: { systemInstruction: system, responseMimeType: "application/json", temperature: 0 } })
        break
      } catch (e) {
        const quota = /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(String((e as Error)?.message ?? e))
        if (!quota || i === models.length - 1) throw e
      }
    }
    if (!res) throw new Error("Gemini: no response")
    text = res.text ?? ""
    inputTokens = res.usageMetadata?.promptTokenCount ?? 0
    outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0
  } else if (creds.provider === "openai" || creds.provider === "openrouter") {
    const url = creds.provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions"
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json",
        ...(creds.provider === "openrouter" ? { "HTTP-Referer": env.appUrl(), "X-Title": "Tilo" } : {}),
      },
      body: JSON.stringify({
        model: creds.model,
        temperature: 0,
        response_format: { type: "json_object" },
        // Room for the model's reasoning plus the answer; low effort keeps it fast and cheap
        ...(creds.provider === "openrouter" ? { max_tokens: 6000, reasoning: { effort: "low" } } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`${creds.provider === "openrouter" ? "OpenRouter" : "OpenAI"}: ${data.error?.message ?? res.status}`)
    text = data.choices?.[0]?.message?.content ?? ""
    if (!text.trim()) throw new Error(`${creds.model} returned no text (finish: ${data.choices?.[0]?.finish_reason ?? "?"})`)
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
  return parseJsonLoose<T>(text, feature)
}

// Models sometimes wrap the JSON in prose or a code fence, or add a second object after it:
// take the first balanced {...} that parses
function parseJsonLoose<T>(text: string, feature: string): T {
  const clean = text.replace(/```(?:json)?/gi, "")
  for (let start = clean.indexOf("{"); start !== -1; start = clean.indexOf("{", start + 1)) {
    let depth = 0
    let inString = false
    for (let i = start; i < clean.length; i++) {
      const ch = clean[i]
      if (inString) {
        if (ch === "\\") i++
        else if (ch === '"') inString = false
      } else if (ch === '"') inString = true
      else if (ch === "{") depth++
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(clean.slice(start, i + 1)) as T
        } catch {
          break
        }
      }
    }
  }
  console.error(`[ai] invalid JSON for ${feature}:`, text.slice(0, 500))
  throw new Error(`The AI returned invalid JSON for ${feature}: ${JSON.stringify(text.slice(0, 160))} … ${JSON.stringify(text.slice(-160))} (${text.length} chars)`)
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

// ---------- Progress ----------

// The day's panorama: what matters most right now for the person's goals, from today's data and
// the week's trend. Rewritten whenever the data changes, avoiding the previous wording.
export async function readProgress(userId: string, facts: Record<string, unknown>, today: string, localTime: string, previous: string[]): Promise<string[]> {
  const r = await generateJson<{ bullets?: string[] }>(
    userId,
    "insights",
    `You are the person's health and performance coach, looking at their dashboard at ${localTime} on ${today}. Write exactly 4 short lines in Rioplatense Spanish (vos), max 24 words each, that orient their next hours toward their goals.
How to choose:
1. Start from TODAY (today_* fields, last night's sleep, sessions done, habits pending, water and protein so far) and say what's left and what to do about it given the time of day (e.g. at 18:00 with 900 ml of 2800, that's the priority; if they already trained, acknowledge it and point to recovery/protein).
2. Then the 7-day trend that most affects their main goal (weight goal and date first, then strength, sleep, steps), with concrete numbers. Explain cause and effect when the data supports it (short sleep and higher resting HR, no meals logged so the deficit is unknown, protein vs strength sessions).
3. Never repeat a line from the previous panorama below unless the situation is the same and still the top priority; rephrase and update the numbers.
schedule_rest_of_today lists what's left on their calendar: real meetings and their own routine blocks (training, swimming, dinner, learning, walking the dog). Use it to time the advice ("antes de Running a las 17:30, tomá agua"), never call routine blocks "reuniones", and don't count events.
Rules: use only the numbers given, never invent; null means unknown. Round naturally (hours and minutes for sleep, liters for water). No medical diagnoses, no emojis, no generic advice. strength_sessions_week counts gym sessions from the watch; logged_gym_sets_week only sets typed in Tilo.
Return {"bullets": string[]}.`,
    JSON.stringify({ facts, previous_panorama: previous }),
  )
  return (r.bullets ?? []).filter((b) => typeof b === "string" && b.trim()).slice(0, 4).map((b) => b.trim().slice(0, 240))
}

// ---------- Habits ----------

// For habit names the keyword rules don't recognise ("Jugar al squash con Juan", "Rutina de core"):
// is it physical activity, and which session types count? Asked once per habit, cached in auto_rule.
export async function classifyHabit(userId: string, name: string, types: string[]): Promise<string[]> {
  const r = await generateJson<{ types?: string[] }>(
    userId,
    "habit",
    `A person tracks the daily habit below. If doing it means a workout or sport session that a watch, Strava, Apple Health or Google Health would record, return which session types count, chosen ONLY from: ${types.join(", ")}. "other" is a generic gym workout. If it is not physical exercise (reading, meditating, studying, drinking water, sleeping), return an empty list. Return {"types": string[]}.`,
    JSON.stringify({ habit: name }),
  )
  return (r.types ?? []).filter((t) => types.includes(t))
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
