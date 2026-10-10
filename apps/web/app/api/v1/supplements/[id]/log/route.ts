import { apiRoute, BadRequestError, parseDate, readJson } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// PUT { taken, date }
export const PUT = apiRoute(async ({ uid, req, params }) => {
  const body = await readJson(req)
  if (typeof body.taken !== "boolean") throw new BadRequestError("taken must be a boolean")
  return new ServerTiloApi(uid).setSupplement(params.id, body.taken, parseDate(body.date))
})
