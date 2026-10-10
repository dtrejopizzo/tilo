import { apiRoute } from "@/lib/server/apiRoute"
import { userDb } from "@/lib/server/userDb"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"

// Everything Settings edits, in one call
export const GET = apiRoute(async ({ uid }) => {
  const db = userDb(uid)
  const [habits, supplements, routines, items, projects, exercises] = await Promise.all([
    db.select("habits").eq("archived", false).order("position"),
    db.select("supplements").eq("archived", false).order("position"),
    db.select("routines").eq("archived", false).order("position"),
    db.select("routine_items").order("position"),
    db.select("projects").eq("archived", false).order("position"),
    supabaseAdmin().from("exercises").select("id, user_id, name, name_es, primary_muscle, kind").or(`user_id.is.null,user_id.eq.${uid}`).order("name_es"),
  ])
  const routineItems = (items.data ?? []) as unknown as { routine_id: string }[]
  return {
    habits: habits.data ?? [],
    supplements: supplements.data ?? [],
    routines: ((routines.data ?? []) as unknown as { id: string }[]).map((r) => ({ ...r, items: routineItems.filter((i) => i.routine_id === r.id) })),
    projects: projects.data ?? [],
    exercises: exercises.data ?? [],
  }
})
