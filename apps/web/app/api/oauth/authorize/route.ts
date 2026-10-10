import { NextResponse, type NextRequest } from "next/server"
import { getClient, issueCode } from "@/lib/server/mcpOauth"
import { requireUser } from "@/lib/server/requireUser"

export const runtime = "nodejs"

// Form POST from the consent page (/oauth/authorize)
export async function POST(req: NextRequest) {
  const uid = await requireUser(req, { allowApiToken: false })
  if (uid instanceof NextResponse) return uid
  const f = await req.formData()
  const clientId = String(f.get("client_id"))
  const redirectUri = String(f.get("redirect_uri"))
  const state = f.get("state") ? String(f.get("state")) : null
  const client = await getClient(clientId)
  if (!client || !client.redirect_uris.includes(redirectUri)) return NextResponse.json({ error: "invalid_client" }, { status: 400 })
  const target = new URL(redirectUri)
  if (f.get("decision") !== "allow") {
    target.searchParams.set("error", "access_denied")
  } else {
    target.searchParams.set("code", await issueCode(uid, clientId, redirectUri, String(f.get("code_challenge")), String(f.get("scope") ?? "")))
  }
  if (state) target.searchParams.set("state", state)
  return NextResponse.redirect(target, 303)
}
