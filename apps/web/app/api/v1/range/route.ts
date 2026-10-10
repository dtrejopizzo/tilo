import { apiRoute, BadRequestError, parseDate } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// GET /api/v1/range?from=&to= → daily rollups for Stats (public.get_range)
export const GET = apiRoute(({ uid, req }) => {
  const from = parseDate(req.nextUrl.searchParams.get("from"))
  const to = parseDate(req.nextUrl.searchParams.get("to"))
  if (from > to) throw new BadRequestError("from must be on or before to")
  return new ServerTiloApi(uid).getRange(from, to)
})
