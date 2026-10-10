import { apiRoute, oneOf, readJson, str } from "@/lib/server/apiRoute"
import { createApiToken, listApiTokens } from "@/lib/server/apiTokens"

export const runtime = "nodejs"

// Token management needs a signed-in browser session: a token can't mint more tokens
export const GET = apiRoute(({ uid }) => listApiTokens(uid), { allowApiToken: false })

export const POST = apiRoute(
  async ({ uid, req }) => {
    const body = await readJson(req)
    return createApiToken(uid, str(body, "name", { max: 60 }) ?? "API token", oneOf(body.kind, ["personal", "ingest"] as const, "kind") ?? "personal")
  },
  { allowApiToken: false },
)
