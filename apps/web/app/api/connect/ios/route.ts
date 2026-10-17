import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { createApiToken } from "@/lib/server/apiTokens"
import { requireUser } from "@/lib/server/requireUser"

export const runtime = "nodejs"

// Browser login for the iPhone app (integrations/ios). The app opens this page in a secure web
// session; after Google sign-in we create a sync token and hand it back through tilohealth://.
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") ?? ""
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(state)) return NextResponse.json({ error: "Invalid state" }, { status: 400 })
  const uid = await requireUser(req, { allowApiToken: false })
  if (uid instanceof NextResponse) {
    const back = `/api/connect/ios?${new URLSearchParams({ state })}`
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url))
  }
  const { token } = await createApiToken(uid, `iPhone (${new Date().toISOString().slice(0, 10)})`, "ingest")
  return NextResponse.redirect(`tilohealth://auth?${new URLSearchParams({ token, url: env.appUrl(), state })}`)
}
