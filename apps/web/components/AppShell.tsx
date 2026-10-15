"use client"

import { ChevronLeft, ChevronRight, Dumbbell, LogOut, Settings as SettingsIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState, type ReactNode } from "react"
import { addDays, DEMO, formatDay, localDate, tilo } from "@/lib/client/api"
import { supabaseBrowser } from "@/lib/supabase/browser"
import { ToastProvider } from "@/lib/client/toast"
import { invalidateDay, useDay } from "@/lib/client/useDay"
import { QuickAdd } from "./QuickAdd"
import { SettingsDrawer } from "./SettingsDrawer"

// Tilo is named after an Australian Shepherd: the brand mark is a blue merle Aussie
export const LOGO = <img src="/icon.svg" alt="" width={28} height={28} />

export function useSelectedDate(): [string, (d: string) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const date = params.get("date") ?? localDate()
  return [date, (d) => router.replace(d === localDate() ? pathname : `${pathname}?date=${d}`, { scroll: false })]
}

function TopBar({ user }: { user: { name: string; avatar: string | null } }) {
  const pathname = usePathname()
  const [date, setDate] = useSelectedDate()
  const [settings, setSettings] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [syncState, setSyncState] = useState<"syncing" | "ok" | "idle">("idle")
  const router = useRouter()
  const params = useSearchParams()
  // The selected day feeds the quick-add parser (habits, supplements, projects) and the training button
  const { day, mutate } = useDay(date)

  async function train() {
    if (!day) return
    const open = day.workouts.find((w) => !w.ended_at)
    const w = open ?? (await mutate(null, () => tilo.startWorkout({ routine_id: day.routine?.id, name: day.routine?.name, date })))
    if (w) router.push(`/workout/${w.id}?date=${date}`)
  }
  const openWorkout = day?.workouts.find((w) => !w.ended_at)

  // Ask the server to pull from Strava / Google Health: on open, every 10 minutes while the tab is
  // visible, and when it comes back to the front. The server skips providers that synced recently.
  useEffect(() => {
    let last = 0
    let busy = false
    const sync = (minGap: number) => {
      if (busy || Date.now() - last < minGap || document.visibilityState === "hidden") return
      busy = true
      last = Date.now()
      setSyncState("syncing")
      tilo
        .request<{ synced: number }>("POST", "/sync", { date: localDate() })
        .then((r) => {
          setSyncState("ok")
          if (r.synced) invalidateDay(localDate())
        })
        .catch(() => setSyncState("idle"))
        .finally(() => (busy = false))
    }
    sync(0)
    const timer = setInterval(() => sync(10 * 60_000), 60_000)
    const onVisible = () => document.visibilityState === "visible" && sync(5 * 60_000)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  useEffect(() => {
    const s = params.get("settings")
    if (s) setSettings(s)
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      if (e.key === ",") setSettings("goals")
      if (e.key === "ArrowLeft" && e.altKey) setDate(addDays(date, -1))
      if (e.key === "ArrowRight" && e.altKey) setDate(addDays(date, 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [params, date, setDate])

  // The local date can differ between the server (UTC) and the browser: label it after mount
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isStats = pathname.startsWith("/stats")
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
  return (
    <header className="topbar">
      <Link href="/" className="brand">{LOGO}Tilo</Link>
      {!isStats && (
        <div className="datenav">
          <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior"><ChevronLeft /></button>
          <b>{mounted ? formatDay(date) : ""}</b>
          <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente"><ChevronRight /></button>
        </div>
      )}
      <nav className="seg" aria-label="Secciones">
        <Link href="/" className={!isStats ? "on" : ""}>Today</Link>
        <Link href="/stats" className={isStats ? "on" : ""}>Stats</Link>
      </nav>
      <div className="topbar-qa desktop-only"><QuickAdd date={date} day={day} mode="nav" /></div>
      <span className="spacer mobile-spacer" />
      <button className={`btn sm desktop-only ${openWorkout ? "leaf" : "ghost"}`} onClick={train} title={day?.routine ? `Rutina de hoy: ${day.routine.name}` : "Entrenamiento libre"}>
        <Dumbbell /><span>{openWorkout ? "Continuar entreno" : "Entrenar"}</span>
      </button>
      <span className="sync"><i className={syncState === "ok" ? "" : "off"} />{syncState === "syncing" ? "sincronizando…" : syncState === "ok" ? "al día" : "sin conexiones"}</span>
      <button className="iconbtn" onClick={() => setSettings("goals")} aria-label="Settings (,)"><SettingsIcon /></button>
      <div style={{ position: "relative" }}>
        <button className="avatar" onClick={() => setMenu(!menu)} aria-label="Cuenta" aria-expanded={menu}>
          {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : initials}
        </button>
        {menu && (
          <div className="card" style={{ position: "absolute", right: 0, top: 38, minWidth: 200, padding: 6, zIndex: 30 }}>
            <div className="row"><span className="t">{user.name}</span></div>
            <button className="row" style={{ width: "100%", border: 0, background: "none", cursor: "pointer" }} onClick={() => { setMenu(false); setSettings("connections") }}>Conectá tus datos</button>
            <button className="row" style={{ width: "100%", border: 0, background: "none", cursor: "pointer" }} onClick={() => { setMenu(false); router.push("/connect") }}>Asistente de configuración</button>
            <button
              className="row"
              style={{ width: "100%", border: 0, background: "none", cursor: "pointer", color: "var(--danger)" }}
              onClick={async () => {
                if (!DEMO) await supabaseBrowser().auth.signOut()
                router.replace("/login")
              }}
            >
              <LogOut size={15} /> Cerrar sesión
            </button>
          </div>
        )}
      </div>
      {settings && <SettingsDrawer initial={settings} onClose={() => setSettings(null)} />}
    </header>
  )
}

export function AppShell({ user, children }: { user: { name: string; avatar: string | null }; children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="shell">
        <Suspense fallback={<header className="topbar"><span className="brand">{LOGO}Tilo</span></header>}>
          <TopBar user={user} />
        </Suspense>
        {children}
      </div>
    </ToastProvider>
  )
}
