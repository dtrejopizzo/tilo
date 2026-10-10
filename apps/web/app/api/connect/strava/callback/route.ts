import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { readState } from "@/lib/server/connections"
import { connectStrava } from "@/lib/server/strava"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  let back = "/"
  try {
    const state = readState(p.get("state"))
    back = typeof state.r === "string" && state.r.startsWith("/") ? state.r : "/"
    if (p.get("error")) throw new Error(p.get("error")!)
    // Strava sends back what the user actually ticked; without activity:read_all the sync gets 401/403
    const granted = (p.get("scope") ?? "").split(",")
    if (!granted.includes("activity:read_all")) throw new Error("Strava: marcá 'Ver datos de tus actividades privadas' al conectar")
    await connectStrava(state.u, p.get("code")!)
    return NextResponse.redirect(new URL(`${env.appUrl()}${back}${back.includes("?") ? "&" : "?"}connected=strava`))
  } catch (error) {
    console.error("[strava] connect failed:", error)
    return NextResponse.redirect(new URL(`${env.appUrl()}${back}?connect_error=${encodeURIComponent(String(error instanceof Error ? error.message : error))}`))
  }
}
