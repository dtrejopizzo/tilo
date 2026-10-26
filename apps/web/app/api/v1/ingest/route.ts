import type { IngestPayload } from "@tilo/core/apiTypes"
import { apiRoute, BadRequestError, readJson } from "@/lib/server/apiRoute"
import { fromHealthAutoExport, ingest } from "@/lib/server/ingest"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60

// POST device data. Accepts Tilo's format (IngestPayload) or Health Auto Export's JSON.
// Authenticate with "Authorization: Bearer tilo_…" (an ingest or personal token).
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  const data = body.data as { metrics?: unknown; workouts?: unknown } | undefined
  const payload: IngestPayload =
    data && (Array.isArray(data.metrics) || Array.isArray(data.workouts))
      ? fromHealthAutoExport(body as Parameters<typeof fromHealthAutoExport>[0])
      : (body as unknown as IngestPayload)
  if (!payload.source) throw new BadRequestError("source is required")
  const diag = (body as { diagnostics?: unknown }).diagnostics
  if (diag && typeof diag === "object") {
    const db = supabaseAdmin()
    const { data } = await db.from("settings").select("data").eq("user_id", uid).maybeSingle()
    await db.from("settings").upsert({ user_id: uid, data: { ...((data?.data as object) ?? {}), ios_diagnostics: { ...diag, received_at: new Date().toISOString() } }, updated_at: new Date().toISOString() })
  }
  return ingest(uid, payload)
})
