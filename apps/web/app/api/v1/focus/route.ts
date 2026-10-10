import { apiRoute, numb, oneOf, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

// POST { task_id?, planned_min?, kind?, source?, date } → starts a focus session
export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).startFocus({
    task_id: str(body, "task_id"),
    planned_min: numb(body, "planned_min", { min: 5, max: 480 }),
    kind: oneOf(body.kind, ["focus", "coding"] as const, "kind"),
    source: oneOf(body.source, ["web", "vscode", "mcp"] as const, "source"),
    date: parseDate(body.date),
  })
})
