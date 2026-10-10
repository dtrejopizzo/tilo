import * as vscode from "vscode"
import type { TiloState } from "./state"

const TODO_RE = /(?:\/\/|#|--|\/\*|<!--|;)\s*(TODO|FIXME|TILO|HACK)\b[:(]?\s*(.*?)\s*(?:\*\/|-->)?$/i

async function gitBranch(uri: vscode.Uri): Promise<string | undefined> {
  const git = vscode.extensions.getExtension<{ getAPI(v: 1): { getRepository(u: vscode.Uri): { state: { HEAD?: { name?: string } } } | null } }>("vscode.git")
  try {
    const api = (git?.isActive ? git.exports : await git?.activate())?.getAPI(1)
    return api?.getRepository(uri)?.state.HEAD?.name
  } catch {
    return undefined
  }
}

// "Crear tarea en Tilo" on TODO/FIXME/TILO comments, as a quick fix and an editor command
export class TodoActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix]

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const line = doc.lineAt(range.start.line).text
    const m = line.match(TODO_RE)
    if (!m) return []
    const action = new vscode.CodeAction(`Crear tarea en Tilo: “${(m[2] || m[1]).slice(0, 50)}”`, vscode.CodeActionKind.QuickFix)
    action.command = { command: "tilo.todoToTask", title: "Crear tarea en Tilo", arguments: [doc.uri, range.start.line] }
    return [action]
  }
}

export async function todoToTask(state: TiloState, uri?: vscode.Uri, line?: number) {
  const editor = vscode.window.activeTextEditor
  const doc = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document
  if (!doc) return
  const ln = line ?? editor?.selection.active.line ?? 0
  const text = doc.lineAt(ln).text
  const m = text.match(TODO_RE)
  const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : ""
  const suggestion = (m?.[2] || selected || text.trim()).slice(0, 200)
  const title = await vscode.window.showInputBox({ title: "Nueva tarea desde el código", value: suggestion, prompt: "Podés agregar mañana, !alta o #proyecto" })
  if (!title?.trim()) return
  const branch = await gitBranch(doc.uri)
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
  await state.act(
    async (c) => {
      // Reuse the quick-add parser for dates, priority and project, then attach the code reference
      const { parseQuickAdd } = await import("@tilo/core/quickAdd")
      const p = parseQuickAdd(`tarea: ${title}`, { today: state.date, projects: state.day?.projects.map((x) => x.name) })
      const t = p?.kind === "task" ? p : { title, dueDate: undefined, priority: undefined, project: undefined }
      return c.addTask({
        title: t.title, due_date: t.dueDate, priority: t.priority ?? (m?.[1].toUpperCase() === "FIXME" ? "high" : undefined),
        project: t.project ?? folder?.name, source: "code",
        source_ref: { file: doc.uri.fsPath, line: ln + 1, branch, repo: folder?.name },
      })
    },
    (t) => `Tarea creada: ${t.title}`,
  )
}
