import { apiRoute, parseDate } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// GET /api/v1/day?date=YYYY-MM-DD → everything for that day (public.get_day)
export const GET = apiRoute(({ uid, req }) => new ServerTiloApi(uid).getDay(parseDate(req.nextUrl.searchParams.get("date"))))
