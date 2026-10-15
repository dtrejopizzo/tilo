import { apiRoute, numb, oneOf, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { description, date, meal_type?, eaten_at?, kcal?, protein_g?, carbs_g?, fat_g?, fiber_g? }
// Without kcal, Tilo's AI estimates everything (needs trial/Pro or your own key).
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).addMeal({
    description: str(body, "description", { required: true, max: 500 })!,
    date: parseDate(body.date),
    meal_type: oneOf(body.meal_type, ["breakfast", "morning_snack", "lunch", "merienda", "afternoon_snack", "dinner", "snack"] as const, "meal_type"),
    eaten_at: str(body, "eaten_at", { max: 8 }),
    kcal: numb(body, "kcal", { min: 0, max: 5000 }),
    protein_g: numb(body, "protein_g", { min: 0, max: 500 }),
    carbs_g: numb(body, "carbs_g", { min: 0, max: 800 }),
    fat_g: numb(body, "fat_g", { min: 0, max: 400 }),
    fiber_g: numb(body, "fiber_g", { min: 0, max: 150 }),
  })
})
