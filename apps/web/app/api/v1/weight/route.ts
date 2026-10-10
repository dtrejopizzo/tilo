import { apiRoute, numb, parseDate, readJson } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { kg, body_fat_pct?, date }
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).addWeight(
    numb(body, "kg", { required: true, min: 20, max: 400 })!,
    numb(body, "body_fat_pct", { min: 2, max: 70 }),
    parseDate(body.date),
  )
})
