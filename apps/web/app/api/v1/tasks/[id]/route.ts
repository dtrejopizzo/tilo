import { apiRoute, NotFoundError, oneOf, parseDate, readJson, str } from "@/lib/server/apiRoute"
import { ServerTiloApi } from "@/lib/server/tiloServer"
import { userDb } from "@/lib/server/userDb"

export const runtime = "nodejs"

// PATCH { status?, title?, notes?, priority?, due_date?, project_id?, project? (name, created if new), date }
export const PATCH = apiRoute(async ({ uid, req, params }) => {
  const body = await readJson(req)
  const patch: Record<string, unknown> = {}
  if ("status" in body) patch.status = oneOf(body.status, ["todo", "done"] as const, "status")
  if ("title" in body) patch.title = str(body, "title", { required: true, max: 300 })
  if ("notes" in body) patch.notes = str(body, "notes", { max: 5000 }) ?? null
  if ("priority" in body) patch.priority = oneOf(body.priority, ["low", "medium", "high"] as const, "priority")
  if ("due_date" in body) patch.due_date = body.due_date ? parseDate(body.due_date) : null
  if ("project_id" in body) patch.project_id = (body.project_id as string) || null
  if ("project" in body) patch.project = str(body, "project", { max: 60 }) ?? null
  return new ServerTiloApi(uid).updateTask(params.id, patch, parseDate(body.date, new Date().toISOString().slice(0, 10)))
})

export const DELETE = apiRoute(async ({ uid, params }) => {
  const { data } = await userDb(uid).delete("tasks").eq("id", params.id).select("id")
  if (!data?.length) throw new NotFoundError("Task not found")
})
