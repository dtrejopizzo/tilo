import { apiRoute, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { text, date } → parses natural language and saves it (meals are estimated with AI)
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).quickAdd(str(body, "text", { required: true, max: 500 })!, parseDate(body.date))
})
