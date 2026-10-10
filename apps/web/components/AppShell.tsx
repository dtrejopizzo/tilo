"use client"

import { ChevronLeft, ChevronRight, LogOut, Settings as SettingsIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState, type ReactNode } from "react"
import { addDays, DEMO, formatDay, localDate, tilo } from "@/lib/client/api"
import { supabaseBrowser } from "@/lib/supabase/browser"
import { ToastProvider } from "@/lib/client/toast"
import { invalidateDay } from "@/lib/client/useDay"
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

  // Refresh connected services once per visit, then reload today's data
  useEffect(() => {
    setSyncState("syncing")
    tilo
      .request<{ synced: number }>("POST", "/sync", { date: localDate() })
      .then((r) => {
        setSyncState("ok")
        if (r.synced) invalidateDay(localDate())
      })
      .catch(() => setSyncState("idle"))
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
      <span className="spacer" />
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
