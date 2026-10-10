import { randomBytes } from "node:crypto"
import * as vscode from "vscode"
import { localDate, TiloApiError, type TiloClient } from "@tilo/core/client"
import { computeAchievements } from "@tilo/core/achievements"
import { buildMonthStats, fetchRange, rangeToStats, shiftMonth } from "@tilo/core/stats"
import { renderStatsBody, renderStatsMessage, STATS_CSS } from "@tilo/core/statsHtml"

type Message = { type: "prev" | "next" | "today" | "refresh" | "setToken" } | { type: "day"; date: string }

// The "Tilo Stats" editor tab: a GitHub-style monthly dashboard
export class StatsPanel {
  private static current: StatsPanel | undefined

  // Called when a day is clicked: shows that day in the sidebar to edit it
  static onDay: (date: string) => void = () => {}

  static show(context: vscode.ExtensionContext, getClient: () => Promise<TiloClient | null>) {
    if (StatsPanel.current) {
      StatsPanel.current.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel("tilo.stats", "Tilo Stats", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [],
    })
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "tilo-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "tilo-dark.svg"),
    }
    StatsPanel.current = new StatsPanel(panel, getClient)
  }

  // Reloads the open panel, e.g. after logging something from the sidebar
  static reload() {
    StatsPanel.current?.load()
  }

  private month = localDate().slice(0, 7)
  private lastBody = ""

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly getClient: () => Promise<TiloClient | null>,
  ) {
    panel.onDidDispose(() => (StatsPanel.current = undefined))
    panel.webview.onDidReceiveMessage((message: Message) => {
      const thisMonth = localDate().slice(0, 7)
      switch (message.type) {
        case "day":
          return StatsPanel.onDay(message.date)
        case "prev":
          return this.load(shiftMonth(this.month, -1))
        case "next":
          return this.load(this.month < thisMonth ? shiftMonth(this.month, 1) : thisMonth)
        case "today":
          return this.load(thisMonth)
        case "refresh":
          return this.load()
        case "setToken":
          return vscode.commands.executeCommand("tilo.setToken")
      }
    })
    this.load()
  }

  private async load(month = this.month) {
    this.month = month
    if (!this.lastBody) this.setBody(renderStatsMessage("Cargando tus stats…", "Juntando el mes desde Tilo."))

    try {
      const client = await this.getClient()
      if (!client) {
        this.setBody(
          renderStatsMessage("Tilo no está conectado", "Cargá la URL de tu Tilo y un token para ver tus stats.", {
            label: "Conectar",
            action: "setToken",
          }),
        )
        return
      }
      const { from, to } = fetchRange(month)
      const today = localDate()
      const yearFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10)
      const [range, year] = await Promise.all([client.getRange(from, to), client.getRange(yearFrom, today)])
      const stats = buildMonthStats(month, rangeToStats(range), today)
      const achievements = computeAchievements(rangeToStats(year), today)
      const updatedAt = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      this.setBody(renderStatsBody(stats, { updatedAt, achievements }))
    } catch (error) {
      const unauthorized = error instanceof TiloApiError && error.status === 401
      this.setBody(
        renderStatsMessage(
          "No pudimos cargar las stats",
          error instanceof Error ? error.message : String(error),
          unauthorized ? { label: "Conectar", action: "setToken" } : { label: "Reintentar", action: "refresh" },
        ),
      )
    }
  }

  private setBody(body: string) {
    this.lastBody = body
    const nonce = randomBytes(16).toString("base64")
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tilo Stats</title>
<style>body { margin: 0; background: var(--vscode-editor-background); }${STATS_CSS}</style>
</head>
<body>
${body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener("click", (event) => {
    const day = event.target.closest("[data-date]");
    if (day) { vscode.postMessage({ type: "day", date: day.getAttribute("data-date") }); return; }
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    if (button.dataset.action !== "setToken") document.querySelector(".tilo-stats")?.classList.add("loading");
    vscode.postMessage({ type: button.dataset.action });
  });
</script>
</body>
</html>`
  }
}
