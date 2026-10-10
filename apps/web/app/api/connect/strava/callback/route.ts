import { NextResponse, type NextRequest } from "next/server"
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
    await connectStrava(state.u, p.get("code")!)
    return NextResponse.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}connected=strava`, req.url))
  } catch (error) {
    console.error("[strava] connect failed:", error)
    return NextResponse.redirect(new URL(`${back}?connect_error=${encodeURIComponent(String(error instanceof Error ? error.message : error))}`, req.url))
  }
}
