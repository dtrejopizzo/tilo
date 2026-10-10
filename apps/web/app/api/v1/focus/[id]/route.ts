import { apiRoute } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// PATCH { stop: true }
export const PATCH = apiRoute(({ uid, params }) => new ServerTiloApi(uid).stopFocus(params.id))
