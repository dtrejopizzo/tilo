import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { registerTiloTools } from "@tilo/core/mcp"
import { NextResponse, type NextRequest } from "next/server"
import { env } from "@/lib/env"
import { API_TOKEN_PREFIX, verifyApiToken } from "@/lib/server/apiTokens"
import { localToday } from "@/lib/server/jobs"
import { ServerTiloApi } from "@/lib/server/tiloServer"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const maxDuration = 60

// Remote MCP server (Streamable HTTP, stateless). Add https://<your-tilo>/api/mcp to Claude,
// ChatGPT, Copilot or any MCP client; they sign in with OAuth, no token copying needed.
function unauthorized() {
  return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${env.appUrl()}/.well-known/oauth-protected-resource"`,
    },
  })
}

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  const uid = token.startsWith(API_TOKEN_PREFIX) ? await verifyApiToken(token) : null
  if (!uid) return unauthorized()

  const { data: profile } = await supabaseAdmin().from("profiles").select("timezone").eq("id", uid).single()
  const tz = profile?.timezone ?? "UTC"

  const server = new McpServer({ name: "tilo", version: "1.0.0" })
  registerTiloTools(server, new ServerTiloApi(uid), () => localToday(tz))
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(req)
}

export const POST = handle
export const GET = handle
export const DELETE = handle
