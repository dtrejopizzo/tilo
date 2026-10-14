import type { EmailInsight } from "@tilo/core/apiTypes"
import { localDate } from "@tilo/core/client"
import { parseQuickAdd, parseSets } from "@tilo/core/quickAdd"
import * as vscode from "vscode"
import { randomBytes } from "node:crypto"
import { ActivityTracker } from "./activity"
import { Breaks } from "./breaks"
import { registerChat } from "./chat"
import { estimateWithEditorModel } from "./editorAi"
import { Focus } from "./focus"
import { GitTaskWatcher } from "./gitTasks"
import { Reminders } from "./reminders"
import { SettingsPanel } from "./settingsPanel"
import { TiloState } from "./state"
import { StatsPanel } from "./statsPanel"
import { TodoActions, todoToTask } from "./todos"
import { TodayProvider, type TodayNode } from "./todayView"

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR")
const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}L`

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

type Priority = "low" | "medium" | "high"

// Steps 2-4 of a new task: project (existing or new), deadline and priority. undefined = cancelled
async function askTaskDetails(title: string, projects: string[], today: string) {
  const NEW = "$(add) Proyecto nuevo…"
  const NONE = "Sin proyecto"
  const p = await vscode.window.showQuickPick([NEW, NONE, ...projects], { title: `${title} · proyecto (2/4)`, placeHolder: "Elegí uno o creá uno nuevo", ignoreFocusOut: true })
  if (p === undefined) return
  let project: string | undefined = p === NONE ? undefined : p
  if (p === NEW) {
    project = (await vscode.window.showInputBox({ title: `${title} · proyecto nuevo`, placeHolder: "Nombre del proyecto", ignoreFocusOut: true }))?.trim()
    if (!project) return
  }

  const wd = new Date(`${today}T12:00:00Z`).getUTCDay()
  const dates = [
    { label: "Hoy", date: today },
    { label: "Mañana", date: addDays(today, 1) },
    { label: "Este viernes", date: addDays(today, (5 - wd + 7) % 7) },
    { label: "Próximo lunes", date: addDays(today, ((1 - wd + 7) % 7) || 7) },
    { label: "En una semana", date: addDays(today, 7) },
    { label: "Sin fecha", date: undefined },
    { label: "$(calendar) Elegir fecha…", date: "pick" },
  ].map((d) => ({ ...d, description: d.date && d.date !== "pick" ? d.date : undefined }))
  const d = await vscode.window.showQuickPick(dates, { title: `${title} · fecha límite (3/4)`, ignoreFocusOut: true })
  if (!d) return
  let due_date = d.date
  if (due_date === "pick") {
    due_date = (await vscode.window.showInputBox({
      title: `${title} · fecha límite`, placeHolder: "AAAA-MM-DD", value: today, ignoreFocusOut: true,
      validateInput: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v.trim())) ? null : "Usá el formato AAAA-MM-DD"),
    }))?.trim()
    if (!due_date) return
  }

  const pr = await vscode.window.showQuickPick(
    [{ label: "$(arrow-up) Alta", value: "high" as Priority }, { label: "$(dash) Media", value: "medium" as Priority }, { label: "$(arrow-down) Baja", value: "low" as Priority }],
    { title: `${title} · prioridad (4/4)`, ignoreFocusOut: true },
  )
  if (!pr) return
  return { project, due_date, priority: pr.value }
}

export function activate(context: vscode.ExtensionContext) {
  const state = new TiloState(context)
  const activity = new ActivityTracker()
  const breaks = new Breaks(state, activity, context)
  const focus = new Focus(state, activity)
  const reminders = new Reminders(state, activity, context)
  const gitTasks = new GitTaskWatcher(state)
  const provider = new TodayProvider(state)
  const tree = vscode.window.createTreeView("tilo.today", { treeDataProvider: provider })
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  const rest = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 51)
  status.command = "tilo.quickMenu"
  context.subscriptions.push(activity, breaks, focus, reminders, gitTasks, tree, status, rest)

  // Clicking a day in Stats opens it in the sidebar, where everything is editable
  StatsPanel.onDay = (date) => {
    void state.setDate(date)
    void vscode.commands.executeCommand("tilo.today.focus")
  }

  // ---------- status bar ----------
  const renderStatus = () => {
    const v = state.view
    if (!v || !state.isToday()) return status.hide()
    const items = state.config().get<string[]>("statusBar.items") ?? []
    const parts: string[] = []
    if (items.includes("water")) parts.push(`$(beaker) ${litres(v.water.total)}/${litres(v.water.target)}`)
    if (items.includes("habits")) parts.push(`$(check) ${v.checklistDone}/${v.checklistTotal}`)
    if (items.includes("tasks") && v.tasks.dueOrOverdue.length) parts.push(`$(tasklist) ${v.tasks.dueOrOverdue.length}`)
    if (items.includes("energy")) parts.push(`$(pulse) ${v.energy.balance > 0 ? "+" : ""}${fmt(v.energy.balance)}`)
    if (!parts.length) return status.hide()
    status.text = parts.join("  ")
    status.tooltip = new vscode.MarkdownString(
      `**Tilo · hoy**\n\nAgua ${v.water.total}/${v.water.target} ml · Proteína ${v.nutrition.protein}/${v.nutrition.targets.protein} g\n\n` +
        `Checklist ${v.checklistDone}/${v.checklistTotal} · Tareas pendientes ${v.tasks.dueOrOverdue.length}\n\n` +
        `Energía: comiste ${fmt(v.energy.intake)}, gastaste ${fmt(v.energy.total)}\n\n_Click: acciones rápidas_`,
    )
    status.show()
  }
  state.onDidChange(renderStatus)

  // ---------- checkboxes in the tree ----------
  tree.onDidChangeCheckboxState(async (e) => {
    for (const [node, cb] of e.items as ReadonlyArray<[TodayNode, vscode.TreeItemCheckboxState]>) {
      const on = cb === vscode.TreeItemCheckboxState.Checked
      if (node.kind === "task") await state.act((c) => c.updateTask(node.task.id, { status: on ? "done" : "todo" }, state.date))
      if (node.kind === "check") {
        const item = node.item
        await state.act((c) => (item.kind === "habit" ? c.setHabit(item.id, on, state.date) : c.setSupplement(item.id, on, state.date)))
      }
    }
  })

  // ---------- workout rest timer in the status bar ----------
  let restTimer: NodeJS.Timeout | undefined
  const startRest = (seconds: number) => {
    clearInterval(restTimer)
    const until = Date.now() + seconds * 1000
    rest.command = "tilo.logSet"
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000))
      rest.text = `$(watch) descanso ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
      rest.tooltip = "Click: registrar la próxima serie"
      rest.show()
      if (left === 0) {
        clearInterval(restTimer)
        rest.text = "$(flame) ¡Siguiente serie!"
        void vscode.window.showInformationMessage("Terminó el descanso.", "Registrar serie").then((p) => p && vscode.commands.executeCommand("tilo.logSet"))
        setTimeout(() => rest.hide(), 30_000)
      }
    }
    tick()
    restTimer = setInterval(tick, 1000)
  }

  const glass = () => state.config().get<number>("glassSizeMl") ?? 250

  // Meals go to the editor's model first (free); anything else through Tilo's parser
  async function logText(text: string) {
    const parsed = parseQuickAdd(text, {
      today: state.date,
      habits: state.day?.habits.map((h) => ({ id: h.id, name: h.name })),
      supplements: state.day?.supplements.map((s) => ({ id: s.id, name: s.name, dose: s.dose, unit: s.unit })),
      projects: state.day?.projects.map((p) => p.name),
      glassMl: glass(),
    })
    if (parsed?.kind === "meal") {
      const macros = await estimateWithEditorModel(parsed.description)
      if (macros) {
        await state.act(
          (c) => c.addMeal({ description: parsed.description, date: state.date, ...macros, meal_type: parsed.mealType ?? macros.meal_type }),
          (m) => `${m.description} · ${fmt(m.kcal)} kcal (con Copilot)`,
        )
        return
      }
    }
    await state.act((c) => c.quickAdd(text, state.date), (r) => r.summary)
  }

  // ---------- browser login: Tilo creates a token and hands it back through vscode://… ----------
  let loginState: string | null = null
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.path !== "/auth") return
        const q = new URLSearchParams(uri.query)
        const token = q.get("token") ?? ""
        if (!loginState || q.get("state") !== loginState || !token.startsWith("tilo_")) {
          void vscode.window.showErrorMessage("Tilo: el inicio de sesión no coincide. Probá de nuevo desde VSCode.")
          return
        }
        loginState = null
        const url = (q.get("url") ?? "").replace(/\/$/, "")
        const cfg = state.config()
        if (/^https?:\/\/\S+$/.test(url) && url !== cfg.get<string>("apiUrl")) await cfg.update("apiUrl", url, vscode.ConfigurationTarget.Global)
        await state.setToken(token)
        await state.refresh()
        void vscode.window.showInformationMessage(state.day ? `Tilo conectado. ¡Hola, ${state.view?.name || "crack"}!` : "Tilo conectado.")
      },
    }),
  )

  const commands: Record<string, (...args: never[]) => unknown> = {
    "tilo.login": async () => {
      const url = (state.config().get<string>("apiUrl") || "https://tiloapp.vercel.app").replace(/\/$/, "")
      loginState = randomBytes(16).toString("hex")
      const q = new URLSearchParams({ scheme: vscode.env.uriScheme, state: loginState })
      await vscode.env.openExternal(vscode.Uri.parse(`${url}/api/connect/vscode?${q}`))
    },
    "tilo.refresh": () => state.refresh(),
    "tilo.prevDay": () => state.setDate(addDays(state.date, -1)),
    "tilo.nextDay": () => state.setDate(addDays(state.date, 1)),
    "tilo.today": () => state.setDate(localDate()),
    "tilo.openStats": async () => {
      if (await state.requireClient()) StatsPanel.show(context, () => state.client())
    },
    "tilo.openSettings": () => SettingsPanel.show(context, state),
    "tilo.openWeb": () => vscode.env.openExternal(vscode.Uri.parse(state.config().get<string>("apiUrl") || "https://github.com/dtrejopizzo/tiloApp")),

    "tilo.setToken": async () => {
      const cfg = state.config()
      const url = await vscode.window.showInputBox({
        title: "URL de tu Tilo", value: cfg.get<string>("apiUrl") || "", placeHolder: "https://tu-tilo.vercel.app", ignoreFocusOut: true,
        validateInput: (v) => (/^https?:\/\/\S+$/.test(v.trim()) ? null : "Empezá con https://"),
      })
      if (!url) return
      await cfg.update("apiUrl", url.trim().replace(/\/$/, ""), vscode.ConfigurationTarget.Global)
      const token = await vscode.window.showInputBox({
        title: "Token de Tilo", prompt: "Generalo en Tilo → Settings → VSCode y MCP", placeHolder: "tilo_…", password: true, ignoreFocusOut: true,
        validateInput: (v) => (v.trim().startsWith("tilo_") ? null : "Los tokens empiezan con tilo_"),
      })
      if (!token) return
      await state.setToken(token.trim())
      await state.refresh()
      if (state.day) void vscode.window.showInformationMessage(`Tilo conectado. ¡Hola, ${state.view?.name || "crack"}!`)
    },
    "tilo.clearToken": async () => {
      await state.setToken(null)
      await state.refresh()
    },

    "tilo.quickAdd": async () => {
      const text = await vscode.window.showInputBox({
        title: `Registrar en Tilo${state.isToday() ? "" : ` · ${state.date}`}`,
        placeHolder: "2 empanadas · 500 agua · banca 80x8x3 · D3 · tarea: revisar PR mañana !alta · peso 78.6",
      })
      if (text?.trim()) await logText(text.trim())
    },
    "tilo.addTask": async () => {
      const title = (await vscode.window.showInputBox({ title: "Nueva tarea (1/4)", placeHolder: "revisar PR de auth", ignoreFocusOut: true }))?.trim()
      if (!title) return
      const input = await askTaskDetails(title, (state.day?.projects ?? []).map((p) => p.name), state.date)
      if (input) await state.act((c) => c.addTask({ title, ...input }), `Tarea agregada: ${title}`)
    },
    "tilo.logWater": () => state.act((c) => c.addWater(glass(), state.date), (r) => `+${glass()} ml · ${litres(r.total)}/${litres(r.target)}`),
    "tilo.logMeal": async () => {
      const description = await vscode.window.showInputBox({ title: "¿Qué comiste?", placeHolder: "milanesa con puré y una manzana" })
      if (description?.trim()) {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Calculando calorías…" }, () => logText(`comida: ${description.trim()}`))
      }
    },
    "tilo.logWeight": async () => {
      const v = await vscode.window.showInputBox({ title: "Peso (kg)", validateInput: (x) => (Number(x.replace(",", ".")) > 20 ? null : "Ingresá un número") })
      if (v) await state.act((c) => c.addWeight(Number(v.replace(",", ".")), undefined, state.date), `Peso ${v} kg`)
    },
    "tilo.checkin": async () => {
      const levels = ["1 · muy baja", "2 · baja", "3 · normal", "4 · bien", "5 · excelente"]
      const energy = await vscode.window.showQuickPick(levels, { title: "¿Cómo está tu energía?" })
      if (!energy) return
      const mood = await vscode.window.showQuickPick(levels, { title: "¿Y tu ánimo?" })
      await state.act((c) => c.addCheckin({ energy: Number(energy[0]), mood: mood ? Number(mood[0]) : undefined, date: state.date }), "Check-in guardado")
    },

    "tilo.startWorkout": async () => {
      const day = state.day
      if (!day?.workouts.find((w) => !w.ended_at)) {
        const w = await state.act((c) => c.startWorkout({ routine_id: day?.routine?.id, name: day?.routine?.name, date: state.date }), (w) => `${w.name} empezado`)
        if (!w) return
      }
      await vscode.commands.executeCommand("tilo.logSet")
    },
    "tilo.logSet": async () => {
      await state.refresh()
      const day = state.day
      const workout = day?.workouts.find((w) => !w.ended_at)
      if (!day || !workout) return vscode.commands.executeCommand("tilo.startWorkout")
      const items = day.routine?.items ?? []
      const pick = await vscode.window.showQuickPick(
        [
          ...items.map((i) => {
            const done = workout.sets.filter((s) => s.exercise_id === i.exercise_id).length
            const prev = i.last?.[done] ?? i.last?.at(-1)
            return { label: i.exercise.name, description: `${done}/${i.sets} series${prev ? ` · última ${Number(prev.weight_kg ?? 0)}×${prev.reps}` : ""}`, exerciseId: i.exercise_id, rest: i.rest_sec, prev }
          }),
          { label: "$(add) Otro ejercicio…", description: "", exerciseId: "", rest: 120, prev: undefined },
          { label: "$(pass) Terminar entrenamiento", description: `${workout.sets.length} series`, exerciseId: "finish", rest: 0, prev: undefined },
        ],
        { title: `${workout.name} · ¿qué ejercicio?` },
      )
      if (!pick) return
      if (pick.exerciseId === "finish") return vscode.commands.executeCommand("tilo.finishWorkout")
      let exerciseName: string | undefined
      if (!pick.exerciseId) {
        exerciseName = await vscode.window.showInputBox({ title: "Ejercicio", placeHolder: "press militar, dominadas, sentadilla…" })
        if (!exerciseName) return
      }
      const value = await vscode.window.showInputBox({
        title: `${pick.exerciseId ? pick.label : exerciseName} · kg × reps`,
        value: pick.prev ? `${Number(pick.prev.weight_kg ?? 0)}x${pick.prev.reps}` : "",
        placeHolder: "80x8 · 80x8x3 · 80x8 @8 · bw x 12",
      })
      if (!value) return
      const sets = parseSets(value)
      if (!sets?.length) return vscode.window.showErrorMessage("No entendí las series. Probá 80x8 o 80x8x3.")
      let record = false
      for (const s of sets) {
        const r = await state.act((c) => c.addSet(workout.id, { exercise_id: pick.exerciseId || undefined, exercise_name: exerciseName, weight_kg: s.weightKg, reps: s.reps, rpe: s.rpe }))
        record ||= !!r?.records?.e1rm
      }
      vscode.window.setStatusBarMessage(`$(check) ${sets.length} × ${sets[0].reps} @ ${sets[0].weightKg} kg${record ? " · ¡récord!" : ""}`, 4000)
      if (record) void vscode.window.showInformationMessage(`¡Récord en ${pick.exerciseId ? pick.label : exerciseName}!`)
      startRest(pick.rest)
    },
    "tilo.finishWorkout": async () => {
      const w = state.day?.workouts.find((x) => !x.ended_at)
      if (!w) return
      clearInterval(restTimer)
      rest.hide()
      await state.act((c) => c.finishWorkout(w.id), (r) => `${r.name} terminado · ${r.sets.filter((s) => !s.is_warmup).length} series`)
    },

    "tilo.startFocus": () => focus.start(),
    "tilo.stopFocus": () => focus.stop(),
    "tilo.takeBreak": () => breaks.start(),
    "tilo.todoToTask": (uri?: vscode.Uri, line?: number) => todoToTask(state, uri, line),
    "tilo.taskFromInsight": async (node?: TodayNode) => {
      const i = node?.kind === "info" ? (node.payload as EmailInsight | undefined) : undefined
      if (!i) return
      await state.act(async (c) => {
        const t = await c.addTask({
          title: i.category === "reply" ? `Responder a ${i.from_name}: ${i.subject}` : i.subject ?? "Mail",
          due_date: i.due_date ?? state.date, source: "email", source_ref: { message_id: i.message_id },
        })
        await c.request("PATCH", `/crud/email_insights?id=${i.id}`, { values: { task_id: t.id } })
        return t
      }, "Tarea creada desde el mail")
    },

    "tilo.quickMenu": async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(sparkle) Registrar algo…", cmd: "tilo.quickAdd" },
          { label: `$(beaker) Sumar un vaso de agua (${glass()} ml)`, cmd: "tilo.logWater" },
          { label: "$(flame) Registrar comida", cmd: "tilo.logMeal" },
          { label: "$(add) Nueva tarea", cmd: "tilo.addTask" },
          { label: "$(play) Entrenamiento", cmd: "tilo.startWorkout" },
          { label: "$(target) Sesión de foco", cmd: "tilo.startFocus" },
          { label: "$(person) Pausa activa ahora", cmd: "tilo.takeBreak" },
          { label: "$(smiley) Check-in", cmd: "tilo.checkin" },
          { label: "$(dashboard) Registrar peso", cmd: "tilo.logWeight" },
          { label: "$(graph) Stats", cmd: "tilo.openStats" },
          { label: "$(gear) Settings", cmd: "tilo.openSettings" },
        ],
        { title: "Tilo" },
      )
      if (pick) await vscode.commands.executeCommand(pick.cmd)
    },
  }

  for (const [id, fn] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn as (...a: unknown[]) => unknown))
  }
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new TodoActions(), { providedCodeActionKinds: TodoActions.kinds }))
  registerChat(context, state)

  // Refresh periodically, on window focus, on settings and token changes. Each refresh also asks
  // the server to pull from Strava / Google Health; the server skips it when they synced recently.
  let timer: NodeJS.Timeout | undefined
  const schedule = () => {
    clearInterval(timer)
    timer = setInterval(() => void state.refresh(true), Math.max(1, state.config().get<number>("refreshIntervalMinutes") ?? 5) * 60_000)
  }
  schedule()
  let lastFocus = 0
  context.subscriptions.push(
    { dispose: () => clearInterval(timer) },
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused && Date.now() - lastFocus > 60_000) {
        lastFocus = Date.now()
        void state.refresh(true)
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tilo")) {
        schedule()
        breaks.render()
        renderStatus()
      }
    }),
    context.secrets.onDidChange((e) => e.key === "tilo.apiToken" && void state.refresh()),
  )

  // First load, then ask the server to sync connected services and reload
  void state.refresh(true)
  breaks.render()
}

export function deactivate() {}
