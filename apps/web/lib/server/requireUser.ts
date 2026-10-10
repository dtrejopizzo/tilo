import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin, supabaseServer } from "../supabase/server"
import { API_TOKEN_PREFIX, verifyApiToken } from "./apiTokens"

// Who is calling: a signed-in browser (Supabase session cookie), a Supabase access token,
// or a personal / MCP token ("Authorization: Bearer tilo_…"). Returns the uid or a 401 response.
export async function requireUser(
  req: NextRequest,
  { allowApiToken = true }: { allowApiToken?: boolean } = {},
): Promise<string | NextResponse> {
  const header = req.headers.get("authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : null

  if (bearer?.startsWith(API_TOKEN_PREFIX)) {
    if (!allowApiToken) return unauthorized()
    return (await verifyApiToken(bearer)) ?? unauthorized()
  }
  if (bearer) {
    const { data } = await supabaseAdmin().auth.getUser(bearer)
    return data.user?.id ?? unauthorized()
  }
  const { data } = await (await supabaseServer()).auth.getUser()
  return data.user?.id ?? unauthorized()
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
