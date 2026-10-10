import * as vscode from "vscode"
import type { ActivityTracker } from "./activity"
import type { TiloState } from "./state"

// Gentle nudges: water when behind pace, "what did you eat?" at meal times, a daily review.
// They never interrupt while typing: they wait for a few seconds of no editing.
export class Reminders implements vscode.Disposable {
  private timer: NodeJS.Timeout
  private lastWater = 0

  constructor(
    private readonly state: TiloState,
    private readonly activity: ActivityTracker,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.timer = setInterval(() => void this.tick(), 60_000)
  }

  private async once(key: string, fn: () => Promise<unknown>) {
    const d = new Date()
    const k = `rem:${key}:${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (this.context.globalState.get(k)) return
    await this.context.globalState.update(k, true)
    await fn()
  }

  private async tick() {
    const cfg = this.state.config()
    const v = this.state.view
    if (!v || !this.state.isToday() || this.activity.idleMs() < 8_000) return
    const now = new Date()
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`

    // Water: expected pace from 08:00 to 22:00
    if (cfg.get<boolean>("reminders.water") && Date.now() - this.lastWater > (cfg.get<number>("reminders.waterEveryMinutes") ?? 60) * 60_000) {
      const frac = Math.min(1, Math.max(0, (now.getHours() + now.getMinutes() / 60 - 8) / 14))
      const expected = v.water.target * frac
      if (frac > 0.1 && v.water.total < expected - 300) {
        this.lastWater = Date.now()
        const pick = await vscode.window.showInformationMessage(`Vas ${Math.round((expected - v.water.total) / 100) / 10} L atrás con el agua.`, "Sumar un vaso")
        if (pick) await vscode.commands.executeCommand("tilo.logWater")
      }
    }

    for (const t of cfg.get<string[]>("reminders.meals") ?? []) {
      if (hm >= t && hm < addMinutes(t, 90)) {
        await this.once(`meal-${t}`, async () => {
          const pick = await vscode.window.showInformationMessage("¿Qué comiste? Registralo en 5 segundos.", "Registrar comida")
          if (pick) await vscode.commands.executeCommand("tilo.logMeal")
        })
      }
    }

    const review = cfg.get<string>("reminders.dailyReview")
    if (review && hm >= review && hm < addMinutes(review, 60)) {
      await this.once("review", async () => {
        const open = v.checklist.flatMap((g) => g.items).filter((i) => !i.done)
        const msg = `Tu día: ${v.checklistDone}/${v.checklistTotal} del checklist, ${v.tasks.doneToday.length} tareas hechas, balance ${v.energy.balance > 0 ? "+" : ""}${v.energy.balance} kcal.` +
          (open.length ? ` Pendiente: ${open.slice(0, 3).map((i) => i.name).join(", ")}.` : "")
        const pick = await vscode.window.showInformationMessage(msg, "Ver stats", "Check-in")
        if (pick === "Ver stats") await vscode.commands.executeCommand("tilo.openStats")
        if (pick === "Check-in") await vscode.commands.executeCommand("tilo.checkin")
      })
    }
  }

  dispose() {
    clearInterval(this.timer)
  }
}

function addMinutes(hm: string, m: number) {
  const [h, mm] = hm.split(":").map(Number)
  const t = h * 60 + mm + m
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}
