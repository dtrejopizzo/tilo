"use client"

import { Link2 } from "lucide-react"
import Link from "next/link"
import { localDate } from "@/lib/client/api"
import { useDay } from "@/lib/client/useDay"
import { useSelectedDate } from "./AppShell"
import { AgendaCard, ChecklistCard, EnergyCard, Kpis, MealsCard, ProgressCard, TasksCard } from "./DayCards"
import { QuickAdd } from "./QuickAdd"

export function DayGrid({ date }: { date: string }) {
  const { day, view, error, mutate } = useDay(date)
  if (error && !day) return <div className="card"><div className="empty">No pudimos cargar el día: {error}</div></div>
  if (!day || !view) return <div className="card"><div className="empty">Cargando…</div></div>
  const p = { date, day, view, mutate }
  // Desktop: three columns that fill the screen, each scrolls on its own, the page never does.
  // Agenda and tasks side by side (the day's panorama), then energy, habits and meals.
  // The six KPIs run across the top; training is reached from the nav and its kcal show in Energy.
  return (
    <>
      <Kpis {...p} />
      <div className="dash">
        <div className="col tasks"><TasksCard {...p} /></div>
        <div className="col agenda"><AgendaCard {...p} /></div>
        <div className="col status">
          <ProgressCard {...p} />
          <EnergyCard {...p} />
          <MealsCard {...p} />
          <ChecklistCard {...p} />
        </div>
      </div>
    </>
  )
}

export function TodayScreen() {
  const [date] = useSelectedDate()
  const { day } = useDay(date)
  const needsSetup = day && !day.profile.onboarding_done
  return (
    <main className="main dashboard">
      {needsSetup && (
        <div className="reco" style={{ margin: 0 }}>
          <Link2 aria-hidden="true" />
          <span style={{ flex: 1 }}>Conectá tu reloj o celular para que pasos, calorías y entrenamientos lleguen solos.</span>
          <Link className="btn leaf sm" href="/connect">Conectar (2 min)</Link>
        </div>
      )}
      <DayGrid date={date} />
      <div className="mobile-dock">
        <QuickAdd date={date} day={day} compact autoFocusKey={false} />
      </div>
      {date !== localDate() && <p className="hint" style={{ textAlign: "center" }}>Estás editando otro día. Todo lo que registres va a ese día.</p>}
    </main>
  )
}
