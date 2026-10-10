import { apiRoute, numb, parseDate, readJson } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { ml, date }
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).addWater(numb(body, "ml", { required: true, min: 1, max: 5000 })!, parseDate(body.date))
})
