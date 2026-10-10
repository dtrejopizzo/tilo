import { NextResponse, type NextRequest } from "next/server"
import { supabaseServer } from "@/lib/supabase/server"

// Google sign-in lands here with a code; new accounts go to the connect wizard
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const next = req.nextUrl.searchParams.get("next") ?? "/"
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", req.url))
  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error?.message ?? "auth")}`, req.url))
  const { data: profile } = await supabase.from("profiles").select("onboarding_done").eq("id", data.user.id).single()
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"
  return NextResponse.redirect(new URL(!profile?.onboarding_done && safeNext === "/" ? "/connect" : safeNext, req.url))
}
