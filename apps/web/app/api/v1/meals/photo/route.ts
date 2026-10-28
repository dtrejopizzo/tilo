import { apiRoute, BadRequestError, oneOf, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"
export const maxDuration = 60

// POST { image: base64 JPEG/PNG (no data: prefix), mime?, note?, date, meal_type?, eaten_at? }
// → the meal, with foods and macros estimated from the photo
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  const image = typeof body.image === "string" ? body.image.replace(/^data:[^;]+;base64,/, "") : ""
  if (image.length < 1000) throw new BadRequestError("image is required (base64)")
  if (image.length > 6_000_000) throw new BadRequestError("image too large: send it at most ~1600 px")
  const mime = oneOf(body.mime, ["image/jpeg", "image/png", "image/webp", "image/heic"] as const, "mime") ?? "image/jpeg"
  return new ServerTiloApi(uid).addMealPhoto({
    image: { base64: image, mime },
    note: str(body, "note", { max: 300 }),
    date: parseDate(body.date),
    meal_type: oneOf(body.meal_type, ["breakfast", "morning_snack", "lunch", "merienda", "afternoon_snack", "dinner", "snack"] as const, "meal_type"),
    eaten_at: str(body, "eaten_at", { max: 8 }),
  })
})
