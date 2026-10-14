import { after, NextResponse, type NextRequest } from "next/server"
import { listConnections } from "@/lib/server/connections"
import { syncGoogleHealth } from "@/lib/server/google"

export const runtime = "nodejs"
export const maxDuration = 120

// Google Health webhook (see integrations/README.md → "Google Health en tiempo real").
// Google POSTs here seconds after the phone or watch syncs. The subscriber is registered with
// GOOGLE_HEALTH_WEBHOOK_SECRET as its Authorization header, which is how we know it's Google:
// verification sends one request with the secret (expects 2xx) and one without (expects 401).

interface Notification {
  healthUserId?: string
  operation?: string
  dataType?: string
  intervals?: { physicalTimeInterval?: { startTime?: string }; civilIso8601TimeInterval?: { startTime?: string } }[]
}

export async function POST(req: NextRequest) {
  const secret = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET
  if (!secret || req.headers.get("authorization") !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (body?.type === "verification") return NextResponse.json({ ok: true }, { status: 201 })

  // One notification or a batch; each may be wrapped in { data }
  const items: Notification[] = (Array.isArray(body) ? body : [body]).map((n) => n?.data ?? n).filter(Boolean)
  const earliest = new Map<string, number>() // healthUserId → earliest changed day (ms)
  for (const n of items) {
    if (!n.healthUserId) continue
    const starts = (n.intervals ?? []).map((i) => Date.parse(i.physicalTimeInterval?.startTime ?? i.civilIso8601TimeInterval?.startTime ?? "")).filter((t) => !Number.isNaN(t))
    const t = starts.length ? Math.min(...starts) : Date.now()
    earliest.set(n.healthUserId, Math.min(earliest.get(n.healthUserId) ?? Infinity, t))
  }

  // Reply 204 right away (Google retries anything else); the sync runs after the response
  if (earliest.size) {
    after(async () => {
      const conns = (await listConnections("google")).filter((c) => c.health_user_id && earliest.has(c.health_user_id))
      await Promise.allSettled(
        conns.map((c) => {
          const days = Math.min(7, Math.max(1, Math.ceil((Date.now() - earliest.get(c.health_user_id!)!) / 86_400_000) + 1))
          return syncGoogleHealth(c.user_id, c.external_id, days).catch((e) => console.error("[google health] webhook sync:", e))
        }),
      )
    })
  }
  return new NextResponse(null, { status: 204 })
}
