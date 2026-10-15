import { apiRoute, parseDate, readJson } from "@/lib/server/apiRoute"
import { listConnections } from "@/lib/server/connections"
import { gmailInboxCheck, gmailSnapshot, hasFeature, syncGoogleHealth } from "@/lib/server/google"
import { STALE_MS } from "@/lib/server/jobs"
import { syncStrava } from "@/lib/server/strava"

export const runtime = "nodejs"
export const maxDuration = 300

// POST { date } → refreshes connected services that haven't synced in the last few minutes.
// Called by the web app and VSCode when they open, so data is fresh without waiting for cron.
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req).catch(() => ({}) as Record<string, unknown>)
  const date = parseDate(body.date, new Date().toISOString().slice(0, 10))
  // { backfill_days: 365 } forces a sync of every connection that far back (max one year)
  const backfill = Math.min(365, Math.max(0, Number(body.backfill_days) || 0))
  const age = (c: { last_sync_at: string | null }) => (c.last_sync_at ? Date.now() - Date.parse(c.last_sync_at) : Infinity)
  const conns = (await listConnections(undefined, uid)).filter((c) => backfill || age(c) > STALE_MS)
  const results = await Promise.allSettled(
    conns.flatMap((c) => {
      if (c.provider === "strava") return [syncStrava(uid, c.external_id, backfill || 2)]
      if (c.provider === "google") {
        const jobs: Promise<unknown>[] = []
        // New mail → tasks and answered → done on every open; the full inbox snapshot (hundreds of requests) half-hourly
        if (hasFeature(c.scopes, "gmail")) {
          jobs.push(backfill || age(c) > 3 * STALE_MS ? gmailSnapshot(uid, c.external_id, c.account_email ?? "", date, date) : gmailInboxCheck(uid, c.external_id, c.account_email ?? "", date))
        }
        if (hasFeature(c.scopes, "health")) jobs.push(syncGoogleHealth(uid, c.external_id, backfill || 2))
        return jobs
      }
      return []
    }),
  )
  const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason).slice(0, 300)] : []))
  return { synced: conns.length, failed: errors.length, errors }
})
