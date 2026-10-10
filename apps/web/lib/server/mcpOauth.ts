// OAuth 2.1 for the remote MCP endpoint (MCP authorization spec): dynamic client registration,
// authorization code + PKCE (S256), access tokens stored like API tokens (kind "mcp_oauth").
import { createHash } from "node:crypto"
import { env } from "../env"
import { supabaseAdmin } from "../supabase/server"
import { BadRequestError } from "./apiRoute"
import { createApiToken } from "./apiTokens"
import { randomToken, sha256 } from "./crypto"

export const ACCESS_TOKEN_DAYS = 90

export function resourceMetadata() {
  return {
    resource: `${env.appUrl()}/api/mcp`,
    authorization_servers: [env.appUrl()],
    bearer_methods_supported: ["header"],
    resource_name: "Tilo",
  }
}

export function authServerMetadata() {
  const base = env.appUrl()
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["tilo"],
  }
}

function validRedirect(uri: string) {
  try {
    const u = new URL(uri)
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" || /^[a-z][a-z0-9+.-]*:$/.test(u.protocol)
  } catch {
    return false
  }
}

export async function registerClient(body: { client_name?: string; redirect_uris?: string[] }) {
  const uris = (body.redirect_uris ?? []).filter((u) => typeof u === "string" && validRedirect(u))
  if (!uris.length) throw new BadRequestError("redirect_uris must contain at least one valid URI")
  const client_id = randomToken("mcp_", 16)
  const { error } = await supabaseAdmin().from("oauth_clients").insert({ client_id, client_name: body.client_name?.slice(0, 100) ?? null, redirect_uris: uris })
  if (error) throw new Error(error.message)
  return { client_id, client_name: body.client_name ?? null, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }
}

export async function getClient(clientId: string) {
  const { data } = await supabaseAdmin().from("oauth_clients").select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle()
  return data as { client_id: string; client_name: string | null; redirect_uris: string[] } | null
}

export async function issueCode(userId: string, clientId: string, redirectUri: string, codeChallenge: string, scope?: string) {
  const code = randomToken("", 32)
  const { error } = await supabaseAdmin().from("oauth_codes").insert({
    code_hash: sha256(code), client_id: clientId, user_id: userId, redirect_uri: redirectUri, code_challenge: codeChallenge,
    scope: scope ?? null, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (error) throw new Error(error.message)
  return code
}

export async function exchangeCode(params: { code: string; client_id: string; redirect_uri: string; code_verifier: string }) {
  const db = supabaseAdmin()
  const { data } = await db.from("oauth_codes").delete().eq("code_hash", sha256(params.code)).select("*").maybeSingle()
  if (!data || Date.parse(data.expires_at) < Date.now()) throw new BadRequestError("invalid_grant")
  if (data.client_id !== params.client_id || data.redirect_uri !== params.redirect_uri) throw new BadRequestError("invalid_grant")
  const challenge = createHash("sha256").update(params.code_verifier).digest("base64url")
  if (challenge !== data.code_challenge) throw new BadRequestError("invalid_grant")
  const client = await getClient(params.client_id)
  const { token } = await createApiToken(data.user_id, client?.client_name ?? "MCP client", "mcp_oauth", {
    clientId: params.client_id,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_DAYS * 86_400_000),
  })
  return { access_token: token, token_type: "Bearer", expires_in: ACCESS_TOKEN_DAYS * 86400, scope: "tilo" }
}
