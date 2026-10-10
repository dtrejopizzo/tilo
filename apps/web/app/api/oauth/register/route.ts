import { NextResponse, type NextRequest } from "next/server"
import { errorResponse } from "@/lib/server/apiRoute"
import { registerClient } from "@/lib/server/mcpOauth"

export const runtime = "nodejs"

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }

export const OPTIONS = () => new NextResponse(null, { headers: CORS })

// RFC 7591 dynamic client registration (MCP clients register themselves)
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(await registerClient(await req.json()), { status: 201, headers: CORS })
  } catch (error) {
    return errorResponse(error, "oauth register")
  }
}
