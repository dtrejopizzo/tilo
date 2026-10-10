import { apiRoute, numb, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { exercise_id? | exercise_name?, weight_kg?, reps?, rpe?, is_warmup?, duration_s?, distance_m? }
export const POST = apiRoute(async ({ uid, req, params }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).addSet(params.id, {
    exercise_id: str(body, "exercise_id"),
    exercise_name: str(body, "exercise_name", { max: 80 }),
    weight_kg: numb(body, "weight_kg", { min: 0, max: 600 }),
    reps: numb(body, "reps", { min: 0, max: 500 }),
    rpe: numb(body, "rpe", { min: 1, max: 10 }),
    is_warmup: body.is_warmup === true,
    duration_s: numb(body, "duration_s", { min: 0, max: 86400 }),
    distance_m: numb(body, "distance_m", { min: 0, max: 500000 }),
  })
})
