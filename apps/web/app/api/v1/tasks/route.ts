import { apiRoute, oneOf, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"

export const runtime = "nodejs"

export const POST = apiRoute(async ({ uid, req }) => {
  const body = await readJson(req)
  return new ServerTiloApi(uid).addTask({
    title: str(body, "title", { required: true, max: 300 })!,
    notes: str(body, "notes", { max: 5000 }),
    due_date: body.due_date ? parseDate(body.due_date) : undefined,
    priority: oneOf(body.priority, ["low", "medium", "high"] as const, "priority"),
    project: str(body, "project", { max: 60 }),
    source: oneOf(body.source, ["manual", "code", "email", "mcp", "import"] as const, "source"),
    source_ref: body.source_ref && typeof body.source_ref === "object" ? (body.source_ref as Record<string, unknown>) : undefined,
  })
})
