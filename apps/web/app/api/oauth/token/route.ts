import { NextResponse, type NextRequest } from "next/server"
import { BadRequestError } from "@/lib/server/apiRoute"
import { exchangeCode } from "@/lib/server/mcpOauth"

export const runtime = "nodejs"

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization" }

export const OPTIONS = () => new NextResponse(null, { headers: CORS })

export async function POST(req: NextRequest) {
  const form = req.headers.get("content-type")?.includes("application/json")
    ? new Map(Object.entries((await req.json()) as Record<string, string>))
    : new Map((await req.formData()).entries() as Iterable<[string, string]>)
  try {
    if (form.get("grant_type") !== "authorization_code") throw new BadRequestError("unsupported_grant_type")
    const result = await exchangeCode({
      code: String(form.get("code") ?? ""),
      client_id: String(form.get("client_id") ?? ""),
      redirect_uri: String(form.get("redirect_uri") ?? ""),
      code_verifier: String(form.get("code_verifier") ?? ""),
    })
    return NextResponse.json(result, { headers: { ...CORS, "Cache-Control": "no-store" } })
  } catch (error) {
    const code = error instanceof BadRequestError ? error.message : "server_error"
    return NextResponse.json({ error: code }, { status: error instanceof BadRequestError ? 400 : 500, headers: CORS })
  }
}
