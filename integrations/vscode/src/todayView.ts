import type { Task } from "@tilo/core/apiTypes"
import type { ChecklistItem } from "@tilo/core/today"
import * as vscode from "vscode"
import type { TiloState } from "./state"

type Node =
  | { kind: "section"; id: string; label: string; description?: string; icon?: string; collapsed?: boolean }
  | { kind: "task"; task: Task }
  | { kind: "check"; item: ChecklistItem }
  | { kind: "stat"; id: string; label: string; description: string; icon: string; command?: string; tooltip?: string; color?: string }
  | { kind: "info"; id: string; label: string; description?: string; icon?: string; contextValue?: string; payload?: unknown; tooltip?: string }

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR")
const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}L`

export class TodayProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(private readonly state: TiloState) {
    state.onDidChange(() => this.emitter.fire(undefined))
  }

  getTreeItem(n: Node): vscode.TreeItem {
    switch (n.kind) {
      case "section": {
        const item = new vscode.TreeItem(n.label, n.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded)
        item.id = `s:${n.id}`
        item.description = n.description
        item.contextValue = `section-${n.id}`
        if (n.icon) item.iconPath = new vscode.ThemeIcon(n.icon)
        return item
      }
      case "task": {
        const t = n.task
        const done = t.status === "done"
        const item = new vscode.TreeItem(t.title)
        item.id = `t:${t.id}`
        item.checkboxState = done ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked
        const overdue = !done && t.due_date && t.due_date < this.state.date
        const project = this.state.day?.projects.find((p) => p.id === t.project_id)?.name
        item.description = [project ?? null, overdue ? `vencida ${t.due_date}` : t.due_date && t.due_date !== this.state.date ? t.due_date : null, t.priority === "high" ? "alta" : null, t.source === "code" ? "código" : t.source === "email" ? "mail" : null]
          .filter(Boolean)
          .join(" · ")
        item.iconPath = new vscode.ThemeIcon(t.priority === "high" ? "arrow-up" : t.priority === "low" ? "arrow-down" : "dash", overdue ? new vscode.ThemeColor("list.errorForeground") : undefined)
        const ref = t.source_ref as { file?: string; line?: number } | null
        if (ref?.file) {
          item.command = { command: "vscode.open", title: "Abrir", arguments: [vscode.Uri.file(ref.file), { selection: new vscode.Range((ref.line ?? 1) - 1, 0, (ref.line ?? 1) - 1, 0) }] }
          item.tooltip = `${t.title}\n${ref.file}:${ref.line}`
        }
        return item
      }
      case "check": {
        const i = n.item
        const item = new vscode.TreeItem(i.name)
        item.id = `c:${i.id}`
        item.checkboxState = i.done ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked
        item.description = i.auto && i.done ? "auto" : i.detail
        item.iconPath = new vscode.ThemeIcon(i.kind === "supplement" ? (i.lowStock ? "warning" : "beaker") : "circle-large-outline", i.lowStock ? new vscode.ThemeColor("list.warningForeground") : undefined)
        return item
      }
      case "stat": {
        const item = new vscode.TreeItem(n.label)
        item.id = `st:${n.id}`
        item.description = n.description
        item.tooltip = n.tooltip
        item.iconPath = new vscode.ThemeIcon(n.icon, n.color ? new vscode.ThemeColor(n.color) : undefined)
        if (n.command) item.command = { command: n.command, title: n.label }
        return item
      }
      case "info": {
        const item = new vscode.TreeItem(n.label)
        item.id = `i:${n.id}`
        item.description = n.description
        item.tooltip = n.tooltip
        item.contextValue = n.contextValue
        if (n.icon) item.iconPath = new vscode.ThemeIcon(n.icon)
        return item
      }
    }
  }

  getChildren(n?: Node): Node[] {
    const s = this.state
    if (!n) {
      if (s.error) return [{ kind: "info", id: "err", label: s.error, icon: "warning" }]
      if (!s.view || !s.day) return [{ kind: "info", id: "load", label: "Cargando…", icon: "loading~spin" }]
      const v = s.view
      const steps = v.metrics.values.steps
      const nodes: Node[] = []
      if (!s.isToday()) nodes.push({ kind: "info", id: "date", label: `Viendo ${s.date}`, description: "lo que marques va a ese día", icon: "calendar" })
      nodes.push(
        { kind: "stat", id: "water", label: "Agua", description: `${litres(v.water.total)} / ${litres(v.water.target)}`, icon: "beaker", command: "tilo.logWater", tooltip: "Click: sumar un vaso" },
        {
          kind: "stat", id: "kcal", label: "Comidas", icon: "flame", command: "tilo.logMeal", tooltip: "Click: registrar comida",
          description: `${fmt(v.nutrition.kcal)}/${fmt(v.nutrition.targets.kcal)} kcal · P${v.nutrition.protein}/${v.nutrition.targets.protein} C${v.nutrition.carbs} G${v.nutrition.fat}`,
        },
        {
          kind: "stat", id: "energy", label: "Balance", icon: "pulse", color: v.energy.balance < 0 ? "charts.green" : "charts.orange",
          description: `${v.energy.balance > 0 ? "+" : "−"}${fmt(Math.abs(v.energy.balance))} kcal · gastaste ${fmt(v.energy.total)}${v.energy.confidence === "high" ? " (medido)" : ""}`,
          tooltip: `Basal ${v.energy.bmr.kcal} (${v.energy.bmr.method})\nMovimiento ${v.energy.neat.kcal} (${v.energy.neat.method})\nEjercicio ${v.energy.exercise.kcal}\nDigestión ${v.energy.tef.kcal}`,
        },
        { kind: "stat", id: "steps", label: "Pasos", description: steps != null ? `${fmt(steps)} / ${fmt(v.stepsTarget)}` : "conectá un dispositivo", icon: "run" },
        ...(v.metrics.values.sleep_min != null
          ? [{ kind: "stat" as const, id: "sleep", label: "Sueño", description: `${Math.floor(v.metrics.values.sleep_min / 60)} h ${String(v.metrics.values.sleep_min % 60).padStart(2, "0")} min`, icon: "eye-closed" }]
          : []),
        { kind: "stat", id: "stats", label: "Stats del mes", description: "hábitos, tareas, energía, gym, mail", icon: "graph", command: "tilo.openStats" },
        { kind: "section", id: "tasks", label: "Tareas", description: `${v.tasks.dueOrOverdue.length} pendientes · ${v.tasks.doneToday.length} hechas`, icon: "tasklist" },
        { kind: "section", id: "upcoming", label: "Próximas", description: String(v.tasks.upcoming.length + v.tasks.someday.length), collapsed: true, icon: "calendar" },
        { kind: "section", id: "checklist", label: "Hábitos y suplementos", description: `${v.checklistDone}/${v.checklistTotal}`, icon: "checklist" },
      )
      if (v.training.items.length || v.training.activities.length || s.day.workouts.length) {
        nodes.push({ kind: "section", id: "training", label: v.training.routineName ? `Entrenamiento · ${v.training.routineName}` : "Entrenamiento", icon: "flame" })
      } else {
        nodes.push({ kind: "stat", id: "train", label: "Entrenamiento", description: "sin rutina hoy · registrar", icon: "flame", command: "tilo.startWorkout" })
      }
      if (v.email.inboxTotal != null) {
        nodes.push({ kind: "section", id: "mail", label: "Mail", description: `${v.email.unread} no leídos · ${v.email.insights.length} importantes`, icon: "mail", collapsed: !v.email.insights.length })
      }
      return nodes
    }
    if (n.kind !== "section" || !s.view || !s.day) return []
    const v = s.view
    switch (n.id) {
      case "tasks": {
        const t = [...v.tasks.dueOrOverdue, ...v.tasks.doneToday]
        const add: Node = { kind: "stat", id: "add-task", label: "Nueva tarea…", description: "proyecto · fecha · prioridad", icon: "add", command: "tilo.addTask" }
        return t.length ? [...t.map((task) => ({ kind: "task" as const, task })), add] : [{ kind: "info", id: "no-tasks", label: "Nada pendiente para hoy", icon: "pass" }, add]
      }
      case "upcoming":
        return [...v.tasks.upcoming, ...v.tasks.someday].map((task) => ({ kind: "task", task }))
      case "checklist":
        if (!v.checklistTotal) return [{ kind: "info", id: "no-check", label: "Agregá hábitos y suplementos en Settings", icon: "info" }]
        return v.checklist.flatMap((g) => [
          { kind: "info" as const, id: `slot-${g.slot}`, label: g.label, icon: "clock" },
          ...g.items.map((item) => ({ kind: "check" as const, item })),
        ])
      case "training": {
        const out: Node[] = []
        const open = s.day.workouts.find((w) => !w.ended_at)
        out.push({ kind: "stat", id: "start", label: open ? "Continuar entrenamiento" : "Empezar entrenamiento", description: open ? `${open.sets.length} series` : "", icon: "play", command: open ? "tilo.logSet" : "tilo.startWorkout" })
        for (const x of v.training.items) {
          out.push({ kind: "info", id: `ex-${x.id}`, label: x.name, description: `${x.target}${x.last ? ` · última ${x.last}` : ""}`, icon: "symbol-event", tooltip: x.suggestion ?? undefined })
        }
        for (const w of s.day.workouts.filter((w) => w.ended_at)) {
          out.push({ kind: "info", id: `w-${w.id}`, label: `${w.name} ✓`, description: `${w.sets.filter((x) => !x.is_warmup).length} series`, icon: "pass-filled" })
        }
        for (const a of v.training.activities) {
          out.push({
            kind: "info", id: `a-${a.id}`, label: a.name ?? a.type,
            description: `${Math.round(a.duration_s / 60)} min${a.distance_m ? ` · ${(Number(a.distance_m) / 1000).toFixed(1)} km` : ""}${a.kcal ? ` · ${fmt(Number(a.kcal))} kcal` : ""} · ${a.source}`,
            icon: "pulse",
          })
        }
        if (v.training.electrolytes) out.push({ kind: "info", id: "electro", label: `Reponé ~${v.training.electrolytes.sodiumMg} mg de sodio`, description: v.training.electrolytes.reason, icon: "lightbulb" })
        return out
      }
      case "mail":
        return v.email.insights.map((i) => ({
          kind: "info" as const, id: `m-${i.id}`, label: i.from_name ?? "", description: `${i.category === "reply" ? "espera respuesta" : i.category === "deadline" ? `fecha ${i.due_date ?? ""}` : "info"} · ${i.subject}`,
          icon: i.category === "deadline" ? "calendar" : "mail", contextValue: "insight", payload: i, tooltip: i.subject ?? undefined,
        }))
    }
    return []
  }
}

export type { Node as TodayNode }
