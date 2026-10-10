"use client"

import { computeAchievements, type Achievement } from "@tilo/core/achievements"
import { buildMonthStats, fetchRange, rangeToStats, shiftMonth } from "@tilo/core/stats"
import { renderStatsBody, renderStatsMessage, STATS_CSS } from "@tilo/core/statsHtml"
import { useCallback, useEffect, useRef, useState } from "react"
import { addDays, formatDay, localDate, tilo } from "@/lib/client/api"
import { Drawer } from "./Drawer"
import { DayGrid } from "./TodayScreen"

// Same renderer as the VSCode panel (@tilo/core/statsHtml); theme variables are mapped in globals.css
export function StatsScreen() {
  const [month, setMonth] = useState(() => localDate().slice(0, 7))
  const [html, setHtml] = useState(() => renderStatsMessage("Cargando tus stats…", "Juntando el mes."))
  const [openDay, setOpenDay] = useState<string | null>(null)

  const achievements = useRef<Achievement[] | null>(null)

  const load = useCallback(async (m: string) => {
    try {
      const { from, to } = fetchRange(m)
      const today = localDate()
      const [range, year] = await Promise.all([
        tilo.getRange(from, to),
        achievements.current ? null : tilo.getRange(addDays(today, -364), today),
      ])
      if (year) achievements.current = computeAchievements(rangeToStats(year), today)
      const stats = buildMonthStats(m, rangeToStats(range), today)
      setHtml(renderStatsBody(stats, { achievements: achievements.current ?? [], updatedAt: new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) }))
    } catch (e) {
      setHtml(renderStatsMessage("No pudimos cargar las stats", e instanceof Error ? e.message : String(e), { label: "Reintentar", action: "refresh" }))
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [month, load])

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as Element
    const day = target.closest("[data-date]")?.getAttribute("data-date")
    if (day) return setOpenDay(day)
    const action = target.closest("[data-action]")
    if (!action || (action as HTMLButtonElement).disabled) return
    const a = action.getAttribute("data-action")
    const thisMonth = localDate().slice(0, 7)
    if (a === "prev") setMonth(shiftMonth(month, -1))
    else if (a === "next") setMonth(month < thisMonth ? shiftMonth(month, 1) : thisMonth)
    else if (a === "today") setMonth(thisMonth)
    else void load(month)
  }

  return (
    <main className="main">
      <style>{STATS_CSS}</style>
      <div className="stats-host" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {openDay && (
        <Drawer title={formatDay(openDay)} wide onClose={() => { setOpenDay(null); achievements.current = null; void load(month) }}>
          <p className="hint" style={{ margin: 0 }}>Todo lo de ese día, editable. Al cerrar se recalculan las stats.</p>
          <DayGrid date={openDay} />
        </Drawer>
      )}
    </main>
  )
}
