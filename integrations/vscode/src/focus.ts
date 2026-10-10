import * as vscode from "vscode"
import type { ActivityTracker } from "./activity"
import type { TiloState } from "./state"

// Pomodoro-style focus sessions on a task, plus automatic "coding" time: continuous editing
// stretches (closed after 5 idle minutes) are saved as focus sessions so Stats shows focus hours.
export class Focus implements vscode.Disposable {
  readonly item: vscode.StatusBarItem
  private session: { id: string; until: number; task: string | null } | null = null
  private ticker: NodeJS.Timeout
  private coding: { start: number; last: number } | null = null
  private sub: vscode.Disposable

  constructor(
    private readonly state: TiloState,
    private readonly activity: ActivityTracker,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48)
    this.item.command = "tilo.stopFocus"
    this.ticker = setInterval(() => this.tick(), 1000)
    this.sub = activity.onActivity(() => {
      const now = Date.now()
      if (!this.coding) this.coding = { start: now, last: now }
      else this.coding.last = now
    })
  }

  async start() {
    const v = this.state.view
    const tasks = [...(v?.tasks.dueOrOverdue ?? []), ...(v?.tasks.upcoming ?? [])]
    const pick = await vscode.window.showQuickPick(
      [{ label: "$(circle-outline) Sin tarea", id: undefined as string | undefined }, ...tasks.map((t) => ({ label: t.title, description: t.due_date ?? "", id: t.id }))],
      { title: "¿En qué te vas a enfocar?" },
    )
    if (!pick) return
    const minutes = this.state.config().get<number>("focus.minutes") ?? 25
    const r = await this.state.act((c) => c.startFocus({ task_id: pick.id, planned_min: minutes, kind: "focus", source: "vscode" }))
    if (!r) return
    this.session = { id: r.id, until: Date.now() + minutes * 60_000, task: pick.id ? pick.label : null }
    this.tick()
  }

  async stop(reason: "manual" | "done" = "manual") {
    if (!this.session) return
    const s = this.session
    this.session = null
    this.item.hide()
    const r = await this.state.act((c) => c.stopFocus(s.id))
    if (r && reason === "done") {
      const pick = await vscode.window.showInformationMessage(`Sesión de foco terminada: ${r.minutes} min${s.task ? ` en “${s.task}”` : ""}.`, "Otra sesión", "Pausa activa")
      if (pick === "Otra sesión") await this.start()
      if (pick === "Pausa activa") await vscode.commands.executeCommand("tilo.takeBreak")
    }
  }

  private tick() {
    if (this.session) {
      const left = Math.max(0, Math.ceil((this.session.until - Date.now()) / 1000))
      this.item.text = `$(target) ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
      this.item.tooltip = `Foco${this.session.task ? `: ${this.session.task}` : ""}. Click para terminar.`
      this.item.show()
      if (left === 0) void this.stop("done")
    }
    // Close a coding stretch after 5 idle minutes and save it if it was at least 10 minutes long
    if (this.coding && Date.now() - this.coding.last > 5 * 60_000) {
      const c = this.coding
      this.coding = null
      if (c.last - c.start >= 10 * 60_000 && this.state.config().get<boolean>("focus.trackCoding")) void this.saveCoding(c.start, c.last)
    }
  }

  private async saveCoding(start: number, end: number) {
    const client = await this.state.client()
    if (!client) return
    const d = new Date(start)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    await client
      .request("POST", "/crud/focus_sessions", {
        values: { date, started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString(), kind: "coding", source: "vscode" },
      })
      .catch(() => {})
  }

  dispose() {
    clearInterval(this.ticker)
    this.sub.dispose()
    this.item.dispose()
    if (this.coding && this.coding.last - this.coding.start >= 10 * 60_000) void this.saveCoding(this.coding.start, this.coding.last)
  }
}
