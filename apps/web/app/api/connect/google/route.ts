import { NextResponse, type NextRequest } from "next/server"
import { googleAuthorizeUrl, type GoogleFeature } from "@/lib/server/google"
import { requireUser } from "@/lib/server/requireUser"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"

// GET /api/connect/google?features=gmail,calendar,health&return=/
export async function GET(req: NextRequest) {
  const uid = await requireUser(req, { allowApiToken: false })
  if (uid instanceof NextResponse) return NextResponse.redirect(new URL("/login", req.url))
  const features = (req.nextUrl.searchParams.get("features") ?? "gmail,calendar")
    .split(",")
    .filter((f): f is GoogleFeature => ["gmail", "calendar", "health"].includes(f))
  const { data } = await supabaseAdmin().from("profiles").select("email").eq("id", uid).single()
  return NextResponse.redirect(googleAuthorizeUrl(uid, features, data?.email, req.nextUrl.searchParams.get("return") ?? "/"))
}
