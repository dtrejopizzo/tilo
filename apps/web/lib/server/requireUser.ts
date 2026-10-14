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
  // getClaims verifies the JWT signature locally (JWKS cached per instance) instead of asking
  // Supabase Auth on every call; it only falls back to the network for legacy HS256 projects
  if (bearer) {
    const { data } = await supabaseAdmin().auth.getClaims(bearer)
    return data?.claims.sub ?? unauthorized()
  }
  const { data } = await (await supabaseServer()).auth.getClaims()
  return data?.claims.sub ?? unauthorized()
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
