import { apiRoute, numb, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { energy?, mood?, note?, date }
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).addCheckin({
    energy: numb(body, "energy", { min: 1, max: 5 }),
    mood: numb(body, "mood", { min: 1, max: 5 }),
    note: str(body, "note", { max: 500 }),
    date: parseDate(body.date),
  })
})
