"use client"

import { Link2 } from "lucide-react"
import Link from "next/link"
import { localDate } from "@/lib/client/api"
import { useDay } from "@/lib/client/useDay"
import { useSelectedDate } from "./AppShell"
import { AgendaCard, ChecklistCard, EnergyCard, Kpis, MailCard, MealsCard, TasksCard, TrainingCard } from "./DayCards"
import { QuickAdd } from "./QuickAdd"

export function DayGrid({ date }: { date: string }) {
  const { day, view, error, mutate } = useDay(date)
  if (error && !day) return <div className="card"><div className="empty">No pudimos cargar el día: {error}</div></div>
  if (!day || !view) return <div className="card"><div className="empty">Cargando…</div></div>
  const p = { date, day, view, mutate }
  return (
    <>
      <Kpis {...p} />
      <div className="cols">
        <div className="col">
          <AgendaCard {...p} />
          <TasksCard {...p} />
          <ChecklistCard {...p} />
          <MealsCard {...p} />
        </div>
        <div className="col">
          <TrainingCard {...p} />
          <EnergyCard {...p} />
          <MailCard {...p} />
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
    <main className="main">
      {needsSetup && (
        <div className="reco" style={{ margin: 0 }}>
          <Link2 aria-hidden="true" />
          <span style={{ flex: 1 }}>Conectá tu reloj o celular para que pasos, calorías y entrenamientos lleguen solos.</span>
          <Link className="btn leaf sm" href="/connect">Conectar (2 min)</Link>
        </div>
      )}
      <QuickAdd date={date} day={day} />
      <DayGrid date={date} />
      <div className="mobile-dock">
        <QuickAdd date={date} day={day} compact autoFocusKey={false} />
      </div>
      {date !== localDate() && <p className="hint" style={{ textAlign: "center" }}>Estás editando otro día. Todo lo que registres va a ese día.</p>}
    </main>
  )
}
