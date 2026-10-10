import { apiRoute, BadRequestError, oneOf, readJson } from "@/lib/server/apiRoute"
import { encrypt } from "@/lib/server/crypto"
import { must, userDb } from "@/lib/server/userDb"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"

const PROFILE = ["name", "birth_date", "sex", "height_cm", "body_fat_pct", "activity_level", "timezone", "onboarding_done"]
const GOALS = [
  "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "water_ml", "steps", "sleep_min", "weight_target_kg",
  "weight_target_date", "caffeine_max_mg", "caffeine_cutoff", "weekly_sets_target",
]

function pick(obj: unknown, keys: string[], what: string): Record<string, unknown> {
  if (obj == null) return {}
  if (typeof obj !== "object" || Array.isArray(obj)) throw new BadRequestError(`${what} must be an object`)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!keys.includes(k)) throw new BadRequestError(`${what}.${k} can't be changed here`)
    out[k] = v === "" ? null : v
  }
  return out
}

// GET → { profile, goals, settings } (the AI key is never returned, only whether one is set)
export const GET = apiRoute(async ({ uid }) => {
  const db = userDb(uid)
  const [profile, goals, settings] = await Promise.all([
    db.profile(),
    db.select("goals").single(),
    db.select("settings", "data").maybeSingle(),
  ])
  const data = ((settings.data as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown> & { ai?: { provider?: string; model?: string; key_enc?: string } }
  const { ai, ...rest } = data
  return {
    profile: must(profile, "profile"),
    goals: must(goals, "goals"),
    settings: { ...rest, ai: ai?.key_enc ? { provider: ai.provider, model: ai.model ?? null, hasKey: true } : null },
  }
}, { allowApiToken: true })

// PATCH { profile?, goals?, settings? (merged), ai?: { provider, key, model? } | null }
export const PATCH = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  const db = userDb(uid)
  const profile = pick(body.profile, PROFILE, "profile")
  const goals = pick(body.goals, GOALS, "goals")
  if (Object.keys(profile).length) must(await db.updateProfile(profile), "profile")
  if (Object.keys(goals).length) must(await db.update("goals", { ...goals, updated_at: new Date().toISOString() }), "goals")

  if (body.settings !== undefined || body.ai !== undefined) {
    const { data } = await db.select("settings", "data").maybeSingle()
    const current = ((data as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
    const next: Record<string, unknown> = { ...current }
    if (body.settings && typeof body.settings === "object") {
      for (const [k, v] of Object.entries(body.settings as Record<string, unknown>)) {
        if (k === "ai" || k === "calibration") continue // managed separately
        next[k] = v
      }
    }
    if (body.ai === null) delete next.ai
    else if (body.ai && typeof body.ai === "object") {
      const ai = body.ai as Record<string, unknown>
      const provider = oneOf(ai.provider, ["gemini", "openai", "anthropic"] as const, "ai.provider")
      if (!provider || typeof ai.key !== "string" || ai.key.length < 20) throw new BadRequestError("ai needs provider and key")
      next.ai = { provider, key_enc: encrypt(ai.key.trim()), model: typeof ai.model === "string" && ai.model ? ai.model : null }
    }
    must(await supabaseAdmin().from("settings").upsert({ user_id: uid, data: next, updated_at: new Date().toISOString() }), "settings")
  }
  return { ok: true }
})
