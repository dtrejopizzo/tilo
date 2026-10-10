import { NextResponse, type NextRequest } from "next/server"
import { requireUser } from "@/lib/server/requireUser"
import { stravaAuthorizeUrl } from "@/lib/server/strava"

export const runtime = "nodejs"

// GET /api/connect/strava?return=/ → Strava consent screen
export async function GET(req: NextRequest) {
  const uid = await requireUser(req, { allowApiToken: false })
  if (uid instanceof NextResponse) return NextResponse.redirect(new URL("/login", req.url))
  return NextResponse.redirect(stravaAuthorizeUrl(uid, req.nextUrl.searchParams.get("return") ?? "/"))
}
