import { apiRoute, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { date, routine_id?, name? } → starts a workout
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).startWorkout({
    date: parseDate(body.date),
    routine_id: str(body, "routine_id"),
    name: str(body, "name", { max: 60 }),
  })
})
