// Server-side configuration. Missing values fail loudly at the call site that needs them.
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set (see apps/web/.env.example)`)
  return value
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tokenKey: () => required("TOKEN_ENCRYPTION_KEY"), // 32 bytes, base64 (openssl rand -base64 32)
  geminiKey: () => process.env.GEMINI_API_KEY ?? null,
  geminiModel: () => process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  googleClientId: () => required("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  stravaClientId: () => required("STRAVA_CLIENT_ID"),
  stravaClientSecret: () => required("STRAVA_CLIENT_SECRET"),
  stravaVerifyToken: () => required("STRAVA_WEBHOOK_VERIFY_TOKEN"),
  cronSecret: () => required("CRON_SECRET"),
  aiFreeDailyRequests: () => Number(process.env.AI_FREE_DAILY_REQUESTS ?? 30),
}
