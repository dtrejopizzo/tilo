import { after, NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { handleStravaEvent } from "@/lib/server/strava"

export const runtime = "nodejs"

// Subscription validation (one-time, see integrations/README.md)
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env.stravaVerifyToken()) {
    return NextResponse.json({ "hub.challenge": p.get("hub.challenge") })
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

// Strava expects a 200 within 2 seconds; the work runs after responding
export async function POST(req: NextRequest) {
  const event = await req.json().catch(() => null)
  if (event?.object_id && event?.owner_id) {
    after(() => handleStravaEvent(event).catch((e) => console.error("[strava] webhook failed:", e)))
  }
  return NextResponse.json({ ok: true })
}
