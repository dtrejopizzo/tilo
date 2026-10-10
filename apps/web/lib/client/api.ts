"use client"

import { localDate, TiloClient } from "@tilo/core/client"
import { DemoClient } from "./demo"

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "true"

// Same-origin client (the session cookie authenticates every call), or the in-browser demo backend
export const tilo: TiloClient = DEMO ? new DemoClient() : new TiloClient("")

export { localDate }

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

// Generic create / update / delete for in-place edits (see /api/v1/crud/[table])
export const crud = {
  create: <T = Record<string, unknown>>(table: string, values: Record<string, unknown>) =>
    tilo.request<T>("POST", `/crud/${table}`, { values }),
  update: <T = Record<string, unknown>>(table: string, id: string, values: Record<string, unknown>) =>
    tilo.request<T>("PATCH", `/crud/${table}?id=${encodeURIComponent(id)}`, { values }),
  remove: (table: string, id: string) => tilo.request<{ ok: true }>("DELETE", `/crud/${table}?id=${encodeURIComponent(id)}`),
}

export function formatDay(date: string, today = localDate()): string {
  if (date === today) return "Hoy"
  if (date === addDays(today, -1)) return "Ayer"
  if (date === addDays(today, 1)) return "Mañana"
  const s = new Date(`${date}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
  return s[0].toUpperCase() + s.slice(1).replace(".", "")
}

export const fmt = (n: number) => Math.round(n).toLocaleString("es-AR")
export const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}`
