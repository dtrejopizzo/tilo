import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { runSync } from "@/lib/server/jobs"

export const runtime = "nodejs"
export const maxDuration = 300

// Frequent device sync (every 15 minutes from Supabase pg_cron or GitHub Actions, see DEPLOY.md).
// Vercel's own cron only runs daily on the Hobby plan. Webhooks make this a safety net.
// Accepts "Authorization: Bearer $CRON_SECRET" or ?secret= for schedulers that can't set headers.
export async function GET(req: NextRequest) {
  const secret = env.cronSecret()
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? req.nextUrl.searchParams.get("secret")
  if (given !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await runSync())
}

export const POST = GET
