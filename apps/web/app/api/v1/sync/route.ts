import { apiRoute, parseDate, readJson } from "@/lib/server/apiRoute"
import { listConnections } from "@/lib/server/connections"
import { gmailSnapshot, hasFeature, syncGoogleHealth } from "@/lib/server/google"
import { syncStrava } from "@/lib/server/strava"

export const runtime = "nodejs"
export const maxDuration = 300

const STALE_MS = 30 * 60_000

// POST { date } → refreshes connected services that haven't synced in 30 minutes.
// Called by the web app and VSCode when they open, so data is fresh without waiting for cron.
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req).catch(() => ({}) as Record<string, unknown>)
  const date = parseDate(body.date, new Date().toISOString().slice(0, 10))
  // { backfill_days: 365 } forces a sync of every connection that far back (max one year)
  const backfill = Math.min(365, Math.max(0, Number(body.backfill_days) || 0))
  const conns = (await listConnections(undefined, uid)).filter((c) => backfill || !c.last_sync_at || Date.now() - Date.parse(c.last_sync_at) > STALE_MS)
  const results = await Promise.allSettled(
    conns.flatMap((c) => {
      if (c.provider === "strava") return [syncStrava(uid, c.external_id, backfill || 2)]
      if (c.provider === "google") {
        const jobs: Promise<unknown>[] = []
        if (hasFeature(c.scopes, "gmail")) jobs.push(gmailSnapshot(uid, c.external_id, c.account_email ?? "", date, date))
        if (hasFeature(c.scopes, "health")) jobs.push(syncGoogleHealth(uid, c.external_id, backfill || 2))
        return jobs
      }
      return []
    }),
  )
  const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason).slice(0, 300)] : []))
  return { synced: conns.length, failed: errors.length, errors }
})
