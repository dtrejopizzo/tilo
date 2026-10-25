// Server-side configuration. Missing values fail loudly at the call site that needs them.
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set (see apps/web/.env.example)`)
  return value
}

const RETIRED_GEMINI = new Set(["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"])

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tokenKey: () => required("TOKEN_ENCRYPTION_KEY"), // 32 bytes, base64 (openssl rand -base64 32)
  geminiKey: () => process.env.GEMINI_API_KEY ?? null,
  // OpenRouter (preferred when set): one key, a cheap model for everyday work and a better one for meals
  openrouterKey: () => process.env.OPENROUTER_API_KEY || null,
  aiModelCheap: () => process.env.AI_MODEL_CHEAP || "anthropic/claude-haiku-5.5",
  aiModelQuality: () => process.env.AI_MODEL_QUALITY || "anthropic/claude-sonnet-5.5",
  // Google retires model names; a configured one that no longer exists falls back to the current default
  geminiModel: () => {
    const m = process.env.GEMINI_MODEL
    return !m || RETIRED_GEMINI.has(m) ? "gemini-3.8-flash" : m
  },
  googleClientId: () => required("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  stravaClientId: () => required("STRAVA_CLIENT_ID"),
  stravaClientSecret: () => required("STRAVA_CLIENT_SECRET"),
  stravaVerifyToken: () => required("STRAVA_WEBHOOK_VERIFY_TOKEN"),
  cronSecret: () => required("CRON_SECRET"),
  aiFreeDailyRequests: () => Number(process.env.AI_FREE_DAILY_REQUESTS ?? 30),
  // Pro: monthly AI budget per person, priced from tokens (USD per million, Gemini Flash list price)
  aiProMonthlyUsd: () => Number(process.env.AI_PRO_MONTHLY_USD ?? 20),
  aiPriceInputPerM: () => Number(process.env.AI_PRICE_INPUT_PER_M ?? 0.3),
  aiPriceOutputPerM: () => Number(process.env.AI_PRICE_OUTPUT_PER_M ?? 1.5),
}
