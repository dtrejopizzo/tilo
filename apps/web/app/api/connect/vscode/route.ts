import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { createApiToken } from "@/lib/server/apiTokens"
import { requireUser } from "@/lib/server/requireUser"

export const runtime = "nodejs"

// Browser login for the VSCode extension (and forks: Cursor, Windsurf, VSCodium).
// GET /api/connect/vscode?scheme=vscode&state=<nonce> → creates a personal token and hands it back
// to the extension through its URI handler. The token only ever goes to our own extension id.
const EXTENSION_ID = "dtrejopizzo.tilo-vscode"
const SCHEMES = new Set(["vscode", "vscode-insiders", "cursor", "windsurf", "vscodium"])

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const scheme = p.get("scheme") ?? "vscode"
  const state = p.get("state") ?? ""
  if (!SCHEMES.has(scheme) || !/^[A-Za-z0-9_-]{8,64}$/.test(state)) {
    return NextResponse.json({ error: "Invalid scheme or state" }, { status: 400 })
  }
  const uid = await requireUser(req, { allowApiToken: false })
  if (uid instanceof NextResponse) {
    const back = `/api/connect/vscode?${new URLSearchParams({ scheme, state })}`
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url))
  }
  const editor = scheme === "vscode" ? "VSCode" : scheme[0].toUpperCase() + scheme.slice(1)
  const { token } = await createApiToken(uid, `${editor} (${new Date().toISOString().slice(0, 10)})`)
  const q = new URLSearchParams({ token, url: env.appUrl(), state })
  return NextResponse.redirect(`${scheme}://${EXTENSION_ID}/auth?${q}`)
}
