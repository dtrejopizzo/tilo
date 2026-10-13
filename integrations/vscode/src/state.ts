import type { DayData } from "@tilo/core/apiTypes"
import { localDate, TiloApiError, TiloClient } from "@tilo/core/client"
import { buildToday, type TodayView } from "@tilo/core/today"
import * as vscode from "vscode"

const TOKEN_KEY = "tilo.apiToken"

// Shared state: the API client, the day the sidebar shows and its data
export class TiloState {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.changed.event

  date = localDate()
  day: DayData | null = null
  view: TodayView | null = null
  error: string | null = null
  private loading: Promise<void> | null = null

  constructor(readonly context: vscode.ExtensionContext) {}

  config() {
    return vscode.workspace.getConfiguration("tilo")
  }

  async client(): Promise<TiloClient | null> {
    const url = this.config().get<string>("apiUrl")?.trim()
    const token = await this.context.secrets.get(TOKEN_KEY)
    await vscode.commands.executeCommand("setContext", "tilo.connected", !!(url && token))
    return url && token ? new TiloClient(url, token) : null
  }

  // Like client(), but offers to connect when it's missing
  async requireClient(): Promise<TiloClient | null> {
    const c = await this.client()
    if (c) return c
    const pick = await vscode.window.showWarningMessage("Tilo no está conectado todavía.", "Conectar")
    if (pick) await vscode.commands.executeCommand("tilo.login")
    return this.client()
  }

  async setToken(token: string | null) {
    if (token) await this.context.secrets.store(TOKEN_KEY, token)
    else await this.context.secrets.delete(TOKEN_KEY)
  }

  isToday() {
    return this.date === localDate()
  }

  // Follow the calendar while the user is on today; stay put if they navigated elsewhere
  private followToday = true

  async setDate(date: string) {
    this.date = date
    this.followToday = date === localDate()
    await vscode.commands.executeCommand("setContext", "tilo.notToday", !this.isToday())
    this.day = null
    this.view = null
    this.changed.fire()
    await this.refresh()
  }

  refresh(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const client = await this.client()
        if (!client) {
          this.day = null
          this.view = null
          this.error = null
          return
        }
        if (this.followToday && this.date !== localDate()) this.date = localDate() // midnight passed
        this.day = await client.getDay(this.date)
        this.view = buildToday(this.day)
        this.error = null
      } catch (e) {
        this.error = e instanceof TiloApiError && e.status === 401 ? "Token inválido o revocado: reconectá Tilo" : e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = null
        this.changed.fire()
      }
    })()
    return this.loading
  }

  // Runs a write, shows errors, refreshes afterwards
  async act<T>(fn: (c: TiloClient) => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> {
    const client = await this.requireClient()
    if (!client) return
    try {
      const r = await fn(client)
      if (success) vscode.window.setStatusBarMessage(`$(check) ${typeof success === "function" ? success(r) : success}`, 3500)
      return r
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (e instanceof TiloApiError && e.status === 401) {
        const pick = await vscode.window.showErrorMessage(msg, "Conectar")
        if (pick) await vscode.commands.executeCommand("tilo.setToken")
      } else if (e instanceof TiloApiError && e.status === 402) {
        const pick = await vscode.window.showWarningMessage(msg, "Abrir settings de IA")
        if (pick) await vscode.env.openExternal(vscode.Uri.parse(`${this.config().get<string>("apiUrl")}/?settings=ai`))
      } else {
        vscode.window.showErrorMessage(`Tilo: ${msg}`)
      }
    } finally {
      void this.refresh()
    }
  }
}
