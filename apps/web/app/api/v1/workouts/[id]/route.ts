import { apiRoute, NotFoundError, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"
import { userDb } from "@/lib/server/userDb"

export const runtime = "nodejs"

// PATCH { finish?: true, notes? }
export const PATCH = apiRoute(async ({ uid, req, params }) => {
  const body = await readJson(req)
  const api = new ServerTiloApi(uid)
  if (body.finish) return api.finishWorkout(params.id, str(body, "notes", { max: 2000 }))
  const { data } = await userDb(uid).update("workouts", { notes: str(body, "notes", { max: 2000 }) ?? null }).eq("id", params.id).select("*").maybeSingle()
  if (!data) throw new NotFoundError("Workout not found")
  return data
})

export const DELETE = apiRoute(async ({ uid, params }) => {
  const { data } = await userDb(uid).delete("workouts").eq("id", params.id).select("id")
  if (!data?.length) throw new NotFoundError("Workout not found")
})
