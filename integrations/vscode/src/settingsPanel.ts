import type { Goals } from "@tilo/core/apiTypes"
import { randomBytes } from "node:crypto"
import * as vscode from "vscode"
import type { TiloState } from "./state"

type Msg =
  | { type: "saveGoals"; goals: Partial<Goals> }
  | { type: "setConfig"; key: string; value: unknown }
  | { type: "command"; command: string }
  | { type: "openWeb"; path: string }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

// "Tilo Settings" editor tab: synced goals (saved to the account) and this machine's
// breaks, reminders, status bar and focus settings (VSCode configuration).
export class SettingsPanel {
  private static current: SettingsPanel | undefined

  static show(context: vscode.ExtensionContext, state: TiloState) {
    if (SettingsPanel.current) return SettingsPanel.current.panel.reveal()
    const panel = vscode.window.createWebviewPanel("tilo.settings", "Tilo Settings", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] })
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "tilo-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "tilo-dark.svg"),
    }
    SettingsPanel.current = new SettingsPanel(panel, state)
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly state: TiloState,
  ) {
    panel.onDidDispose(() => (SettingsPanel.current = undefined))
    panel.webview.onDidReceiveMessage((m: Msg) => this.onMessage(m))
    void this.render()
  }

  private async onMessage(m: Msg) {
    const cfg = this.state.config()
    if (m.type === "setConfig") {
      await cfg.update(m.key, m.value, vscode.ConfigurationTarget.Global)
    } else if (m.type === "saveGoals") {
      await this.state.act((c) => c.request("PATCH", "/settings", { goals: m.goals }), "Objetivos guardados")
    } else if (m.type === "command") {
      await vscode.commands.executeCommand(m.command)
    } else if (m.type === "openWeb") {
      await vscode.env.openExternal(vscode.Uri.parse(`${cfg.get<string>("apiUrl")}${m.path}`))
    }
  }

  private async render() {
    const cfg = this.state.config()
    const client = await this.state.client()
    let goals: Goals | null = null
    if (client) goals = (await client.request<{ goals: Goals }>("GET", "/settings").catch(() => null))?.goals ?? null
    const nonce = randomBytes(16).toString("base64")
    const num = (key: string, label: string, value: unknown, unit = "", attrs = "") =>
      `<label class="setting"><span class="title"><span class="cat">${label.split(":")[0]}:</span> ${label.split(":")[1] ?? ""}</span><span class="ctl"><input type="number" data-goal="${key}" value="${esc(value)}" ${attrs}> <span class="unit">${unit}</span></span></label>`
    const conf = (key: string, label: string, desc: string, control: string) =>
      `<div class="setting"><div class="title"><span class="cat">${label.split(":")[0]}:</span> ${label.split(":")[1] ?? ""}</div>${desc ? `<div class="desc">${desc}</div>` : ""}<div class="ctl" data-config="${key}">${control}</div></div>`
    const check = (key: string, text: string) => `<label class="chk"><input type="checkbox" data-config="${key}" ${cfg.get(key) ? "checked" : ""}> ${text}</label>`
    const select = (key: string, options: [string | number, string][]) =>
      `<select data-config="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(cfg.get(key)) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`
    const text = (key: string) => `<input type="text" data-config="${key}" value="${esc(cfg.get(key))}">`
    const items = cfg.get<string[]>("statusBar.items") ?? []
    const days = cfg.get<number[]>("breaks.days") ?? []

    this.panel.webview.html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
.wrap { max-width: 820px; margin: 0 auto; padding: 16px 24px 48px; }
h1 { font-size: 22px; font-weight: 600; margin: 8px 0 4px; }
h2 { font-size: 18px; font-weight: 600; margin: 26px 0 2px; display: flex; gap: 10px; align-items: center; }
.badge { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--vscode-charts-green); color: var(--vscode-charts-green); }
.badge.local { border-color: var(--vscode-charts-blue); color: var(--vscode-charts-blue); }
.sub { color: var(--vscode-descriptionForeground); margin: 0 0 6px; }
.setting { display: block; padding: 10px 12px; border-radius: 3px; }
.setting:hover { background: var(--vscode-list-hoverBackground); }
.title { font-weight: 600; margin-bottom: 4px; display: block; }
.cat { font-weight: 400; color: var(--vscode-descriptionForeground); }
.desc { color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
.ctl { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
input[type=number], input[type=text], input[type=date], select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; font: inherit; border-radius: 2px; }
input[type=number] { width: 80px; text-align: right; }
.unit { color: var(--vscode-descriptionForeground); }
.chk { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 5px 12px; border-radius: 2px; cursor: pointer; font: inherit; }
button.sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.days button { padding: 3px 8px; }
.days button[aria-pressed=true] { background: var(--vscode-button-background); }
.days button[aria-pressed=false] { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
</style></head><body><div class="wrap">
<h1>Tilo Settings</h1>
<p class="sub">Los objetivos se guardan en tu cuenta y se ven en la web y el MCP. Las pausas, recordatorios y la status bar son de esta máquina.</p>

<h2>Objetivos <span class="badge">en tu cuenta</span></h2>
${goals ? `<div class="grid">
${num("kcal", "Nutrición: Calorías", goals.kcal, "kcal/día", 'step="10"')}
${num("protein_g", "Nutrición: Proteína", goals.protein_g, "g")}
${num("carbs_g", "Nutrición: Carbos", goals.carbs_g, "g")}
${num("fat_g", "Nutrición: Grasas", goals.fat_g, "g")}
${num("fiber_g", "Nutrición: Fibra", goals.fiber_g, "g")}
${num("water_ml", "Agua: Objetivo", goals.water_ml, "ml", 'step="50"')}
${num("steps", "Movimiento: Pasos", goals.steps, "por día", 'step="500"')}
${num("weekly_sets_target", "Entrenamiento: Series por músculo", goals.weekly_sets_target, "por semana")}
${num("weight_target_kg", "Peso: Objetivo", goals.weight_target_kg, "kg", 'step="0.1"')}
<label class="setting"><span class="title"><span class="cat">Peso:</span> Para el</span><span class="ctl"><input type="date" data-goal="weight_target_date" value="${esc(goals.weight_target_date)}"></span></label>
</div>
<div class="setting"><button id="save-goals">Guardar objetivos</button> <button class="sec" data-web="/?settings=goals">Más en la web: perfil, macros sugeridos</button></div>` : `<p class="sub">Conectá Tilo para editar tus objetivos.</p>`}
<div class="setting"><div class="ctl"><button class="sec" data-web="/?settings=habits">Editar hábitos</button><button class="sec" data-web="/?settings=supplements">Suplementos</button><button class="sec" data-web="/?settings=routines">Rutinas</button><button class="sec" data-web="/?settings=connections">Conexiones</button></div></div>

<h2>Pausas activas <span class="badge local">esta máquina</span></h2>
<p class="sub">Solo cuenta el tiempo que estás editando; si te alejás, el reloj se reinicia.</p>
${conf("breaks.enabled", "Pausas: Activadas", "", check("breaks.enabled", "Recordarme pausas activas"))}
${conf("breaks.everyMinutes", "Pausas: Intervalo", "Minutos de edición antes del recordatorio y duración de la pausa.", select("breaks.everyMinutes", [25, 30, 45, 50, 60, 90].map((n) => [n, `cada ${n} min`])) + select("breaks.lengthMinutes", [1, 2, 5, 10].map((n) => [n, `${n} min`])))}
${conf("breaks.workingHours", "Pausas: Horario", "Formato HH:MM-HH:MM.", text("breaks.workingHours") + `<span class="days">${["L", "M", "X", "J", "V", "S", "D"].map((d, i) => `<button data-day="${i}" aria-pressed="${days.includes(i)}">${d}</button>`).join("")}</span>`)}
${conf("breaks.kind", "Pausas: Tipo", "", select("breaks.kind", [["rotate", "Rotar: caminar, estirar, vista, respiración"], ["walk", "Caminar"], ["stretch", "Estirar"], ["eyes", "Vista 20-20-20"], ["breathe", "Respiración"]]))}
${conf("breaks.habitName", "Pausas: Hábito", "Si tenés un hábito con este nombre, se marca al llegar a la meta diaria.", text("breaks.habitName") + `<input type="number" data-config="breaks.dailyGoal" value="${cfg.get("breaks.dailyGoal")}"> <span class="unit">pausas por día</span>`)}
<div class="setting"><button class="sec" data-command="tilo.takeBreak">Probar una pausa ahora</button></div>

<h2>Recordatorios <span class="badge local">esta máquina</span></h2>
${conf("reminders.water", "Recordatorios: Agua", "Solo cuando venís atrasado respecto de tu objetivo.", check("reminders.water", "Recordarme tomar agua") + `<input type="number" data-config="reminders.waterEveryMinutes" value="${cfg.get("reminders.waterEveryMinutes")}"> <span class="unit">min como máximo</span>`)}
${conf("reminders.meals", "Recordatorios: Comidas", "Horas separadas por coma.", `<input type="text" data-config-list="reminders.meals" value="${esc((cfg.get<string[]>("reminders.meals") ?? []).join(", "))}">`)}
${conf("reminders.dailyReview", "Recordatorios: Resumen del día", "Vacío para desactivar.", text("reminders.dailyReview"))}

<h2>Foco y status bar <span class="badge local">esta máquina</span></h2>
${conf("focus.minutes", "Foco: Duración", "", `<input type="number" data-config="focus.minutes" value="${cfg.get("focus.minutes")}"> <span class="unit">min</span>` + check("focus.trackCoding", "Registrar el tiempo programando como foco"))}
${conf("statusBar.items", "Status bar: Ítems", "", ["water", "habits", "tasks", "energy", "break", "focus"].map((i) => `<label class="chk"><input type="checkbox" data-item="${i}" ${items.includes(i) ? "checked" : ""}> ${{ water: "Agua", habits: "Checklist", tasks: "Tareas", energy: "Balance", break: "Próxima pausa", focus: "Foco" }[i]}</label>`).join(""))}
${conf("glassSizeMl", "Agua: Vaso", "Lo que suma un click en Agua.", `<input type="number" data-config="glassSizeMl" value="${cfg.get("glassSizeMl")}"> <span class="unit">ml</span>`)}
${conf("ai.useEditorModel", "IA: Modelo del editor", "Estimar comidas con tu Copilot (gratis) en vez de la IA de Tilo.", check("ai.useEditorModel", "Usar el modelo de IA de VSCode"))}

<h2>Cuenta</h2>
<div class="setting"><div class="ctl"><span>${esc(cfg.get("apiUrl") || "Sin conectar")}</span><button class="sec" data-command="tilo.setToken">Cambiar URL o token</button><button class="sec" data-command="tilo.clearToken">Desconectar</button></div></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const post = (m) => vscode.postMessage(m);
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.config) {
    const v = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : /^\\d+$/.test(el.value) && el.tagName === "SELECT" ? Number(el.value) : el.value;
    post({ type: "setConfig", key: el.dataset.config, value: v });
  }
  if (el.dataset.configList) post({ type: "setConfig", key: el.dataset.configList, value: el.value.split(",").map((s) => s.trim()).filter(Boolean) });
  if (el.dataset.item) post({ type: "setConfig", key: "statusBar.items", value: [...document.querySelectorAll("[data-item]")].filter((x) => x.checked).map((x) => x.dataset.item) });
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "save-goals") {
    const goals = {};
    document.querySelectorAll("[data-goal]").forEach((i) => { goals[i.dataset.goal] = i.type === "date" ? (i.value || null) : (i.value === "" ? null : Number(i.value)); });
    post({ type: "saveGoals", goals });
  }
  if (b.dataset.web) post({ type: "openWeb", path: b.dataset.web });
  if (b.dataset.command) post({ type: "command", command: b.dataset.command });
  if (b.dataset.day) {
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
    post({ type: "setConfig", key: "breaks.days", value: [...document.querySelectorAll("[data-day]")].filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => Number(x.dataset.day)) });
  }
});
</script></body></html>`
  }
}
