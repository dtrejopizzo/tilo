import { apiRoute, BadRequestError, parseDate, readJson } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// PUT { done, date }
export const PUT = apiRoute(async ({ uid, req, params }) => {
  const body = await readJson(req)
  if (typeof body.done !== "boolean") throw new BadRequestError("done must be a boolean")
  return new ServerTiloApi(uid).setHabit(params.id, body.done, parseDate(body.date))
})
