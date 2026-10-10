import * as vscode from "vscode"
import type { ActivityTracker } from "./activity"
import type { TiloState } from "./state"

const BREAKS = {
  walk: ["Parate y caminá", "Caminá un par de minutos. Pasá a llenar la botella de agua."],
  stretch: ["Estirá", "Cuello, hombros, brazos arriba, tocá la punta de los pies, girá la cadera."],
  eyes: ["Descansá la vista", "Mirá algo a 6 metros durante 20 segundos. Parpadeá despacio."],
  breathe: ["Respiración cuadrada", "Inhalá 4, sostené 4, exhalá 4, sostené 4. Repetí."],
} as const
type Kind = keyof typeof BREAKS

// Active-break reminders based on minutes of real editing, within working hours
export class Breaks implements vscode.Disposable {
  private activeMs = 0
  private lastTick = Date.now()
  private snoozedUntil = 0
  private timer: NodeJS.Timeout
  private running: { until: number; kind: Kind } | null = null
  private prompting = false
  readonly item: vscode.StatusBarItem

  constructor(
    private readonly state: TiloState,
    private readonly activity: ActivityTracker,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49)
    this.item.command = "tilo.takeBreak"
    this.timer = setInterval(() => this.tick(), 15_000)
  }

  private cfg() {
    return this.state.config()
  }

  private inWorkingHours(now = new Date()) {
    const [from, to] = (this.cfg().get<string>("breaks.workingHours") ?? "09:00-19:00").split("-")
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    const days = this.cfg().get<number[]>("breaks.days") ?? [0, 1, 2, 3, 4]
    return hm >= from && hm <= to && days.includes((now.getDay() + 6) % 7)
  }

  private everyMs() {
    return (this.cfg().get<number>("breaks.everyMinutes") ?? 50) * 60_000
  }

  private tick() {
    const now = Date.now()
    const idleReset = (this.cfg().get<number>("breaks.idleResetMinutes") ?? 5) * 60_000
    if (this.activity.idleMs() > idleReset) this.activeMs = 0 // stepping away counts as a break
    else if (this.activity.idleMs() < 120_000) this.activeMs += now - this.lastTick
    this.lastTick = now
    this.render()
    if (!this.cfg().get<boolean>("breaks.enabled") || this.running || this.prompting) return
    if (now < this.snoozedUntil || !this.inWorkingHours()) return
    if (this.activeMs >= this.everyMs()) void this.prompt()
  }

  render() {
    const show = this.cfg().get<boolean>("breaks.enabled") && (this.cfg().get<string[]>("statusBar.items") ?? []).includes("break")
    if (!show) return this.item.hide()
    if (this.running) {
      const left = Math.max(0, Math.ceil((this.running.until - Date.now()) / 1000))
      this.item.text = `$(person) ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
      this.item.tooltip = BREAKS[this.running.kind][1]
    } else {
      const left = Math.max(0, Math.ceil((this.everyMs() - this.activeMs) / 60_000))
      this.item.text = `$(person) ${left}m`
      this.item.tooltip = `Próxima pausa activa en ${left} min de edición. Click para tomarla ahora.`
    }
    this.item.show()
  }

  private kind(): Kind {
    const k = this.cfg().get<string>("breaks.kind") ?? "rotate"
    if (k !== "rotate") return k as Kind
    const all = Object.keys(BREAKS) as Kind[]
    return all[this.todayCount() % all.length]
  }

  private todayKey() {
    const d = new Date()
    return `breaks:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }

  todayCount() {
    return this.context.globalState.get<number>(this.todayKey()) ?? 0
  }

  async prompt() {
    this.prompting = true
    const kind = this.kind()
    const minutes = this.cfg().get<number>("breaks.lengthMinutes") ?? 2
    const pick = await vscode.window.showInformationMessage(
      `Hora de una pausa activa: llevás ${Math.round(this.activeMs / 60_000)} min programando. ${BREAKS[kind][0]} ${minutes} min.`,
      "Empezar pausa",
      "Posponer 10 min",
      "Saltear",
    )
    this.prompting = false
    if (pick === "Empezar pausa") return this.start(kind)
    if (pick === "Posponer 10 min") this.snoozedUntil = Date.now() + 10 * 60_000
    else this.activeMs = 0
  }

  async start(kind = this.kind()) {
    const minutes = this.cfg().get<number>("breaks.lengthMinutes") ?? 2
    this.running = { until: Date.now() + minutes * 60_000, kind }
    this.render()
    const t = setInterval(() => this.render(), 1000)
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `${BREAKS[kind][0]} · ${minutes} min`, cancellable: true },
      (progress, token) =>
        new Promise<void>((resolve) => {
          progress.report({ message: BREAKS[kind][1] })
          const end = setTimeout(resolve, minutes * 60_000)
          token.onCancellationRequested(() => {
            clearTimeout(end)
            resolve()
          })
        }),
    )
    clearInterval(t)
    this.running = null
    this.activeMs = 0
    const count = this.todayCount() + 1
    await this.context.globalState.update(this.todayKey(), count)
    await this.logHabit(count)
    this.render()
    const pick = await vscode.window.showInformationMessage(`Pausa hecha: ${count} hoy.`, "Sumar un vaso de agua")
    if (pick) await vscode.commands.executeCommand("tilo.logWater")
  }

  private async logHabit(count: number) {
    const goal = this.cfg().get<number>("breaks.dailyGoal") ?? 6
    const name = (this.cfg().get<string>("breaks.habitName") ?? "").toLowerCase()
    const habit = this.state.day?.habits.find((h) => h.name.toLowerCase() === name)
    if (habit && !habit.done && count >= goal && this.state.isToday()) {
      await this.state.act((c) => c.setHabit(habit.id, true), `${habit.name} ✓ (${count} pausas)`)
    }
  }

  dispose() {
    clearInterval(this.timer)
    this.item.dispose()
  }
}
