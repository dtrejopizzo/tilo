import { apiRoute, parseDate } from "@/lib/server/apiRoute"
import { calendarEvents } from "@/lib/server/google"
import { supabaseAdmin } from "@/lib/supabase/server"

export const runtime = "nodejs"

// GET ?date= → today's events across connected Google calendars
export const GET = apiRoute(async ({ uid, req }) => {
  const date = parseDate(req.nextUrl.searchParams.get("date"))
  const { data } = await supabaseAdmin().from("profiles").select("timezone").eq("id", uid).single()
  try {
    return { events: await calendarEvents(uid, date, data?.timezone ?? "UTC") }
  } catch (error) {
    console.error("[calendar]", error)
    return { events: [], error: "No pudimos leer tu calendario. Reconectá Google en Settings → Conexiones." }
  }
})
