import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { runDaily } from "@/lib/server/jobs"

export const runtime = "nodejs"
export const maxDuration = 300

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET"
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await runDaily())
}
