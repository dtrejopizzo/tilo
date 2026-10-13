import { after, NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { readState } from "@/lib/server/connections"
import { connectGoogle, gmailSnapshot, GOOGLE_SCOPES, syncGoogleHealth } from "@/lib/server/google"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  let back = "/"
  try {
    const state = readState(p.get("state"))
    back = typeof state.r === "string" && state.r.startsWith("/") ? state.r : "/"
    if (p.get("error")) throw new Error(p.get("error")!)
    const { sub, scopes } = await connectGoogle(state.u, p.get("code")!)
    // First sync in the background so the user lands on data
    after(async () => {
      const { data: c } = await supabaseAdmin().from("connections").select("account_email").eq("user_id", state.u).eq("provider", "google").eq("external_id", sub).single()
      const today = new Date().toISOString().slice(0, 10)
      if (GOOGLE_SCOPES.gmail.every((s) => scopes.includes(s))) await gmailSnapshot(state.u, sub, c?.account_email ?? "", today, today).catch((e) => console.error("[gmail]", e))
      if (GOOGLE_SCOPES.health.every((s) => scopes.includes(s))) await syncGoogleHealth(state.u, sub, 365).catch((e) => console.error("[google health]", e))
    })
    return NextResponse.redirect(new URL(`${env.appUrl()}${back}${back.includes("?") ? "&" : "?"}connected=google`))
  } catch (error) {
    console.error("[google] connect failed:", error)
    return NextResponse.redirect(new URL(`${env.appUrl()}${back}?connect_error=${encodeURIComponent(String(error instanceof Error ? error.message : error))}`))
  }
}
