import { apiRoute, NotFoundError } from "@/lib/server/apiRoute"
import { revokeApiToken } from "@/lib/server/apiTokens"

export const runtime = "nodejs"

export const DELETE = apiRoute(
  async ({ uid, params }) => {
    if (!(await revokeApiToken(uid, params.id))) throw new NotFoundError("Token not found")
  },
  { allowApiToken: false },
)
