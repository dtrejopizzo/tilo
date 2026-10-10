import { apiRoute, parseDate, readJson } from "@/lib/server/apiRoute"
import { listConnections } from "@/lib/server/connections"
import { gmailSnapshot, hasFeature, syncGoogleHealth } from "@/lib/server/google"
import { syncStrava } from "@/lib/server/strava"

export const runtime = "nodejs"
export const maxDuration = 60

const STALE_MS = 30 * 60_000

// POST { date } → refreshes connected services that haven't synced in 30 minutes.
// Called by the web app and VSCode when they open, so data is fresh without waiting for cron.
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req).catch(() => ({}) as Record<string, unknown>)
  const date = parseDate(body.date, new Date().toISOString().slice(0, 10))
  const conns = (await listConnections(undefined, uid)).filter((c) => !c.last_sync_at || Date.now() - Date.parse(c.last_sync_at) > STALE_MS)
  const results = await Promise.allSettled(
    conns.flatMap((c) => {
      if (c.provider === "strava") return [syncStrava(uid, c.external_id, 2)]
      if (c.provider === "google") {
        const jobs: Promise<unknown>[] = []
        if (hasFeature(c.scopes, "gmail")) jobs.push(gmailSnapshot(uid, c.external_id, c.account_email ?? "", date, date))
        if (hasFeature(c.scopes, "health")) jobs.push(syncGoogleHealth(uid, c.external_id, 2))
        return jobs
      }
      return []
    }),
  )
  return { synced: conns.length, failed: results.filter((r) => r.status === "rejected").length }
})
