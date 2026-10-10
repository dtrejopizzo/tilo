// Achievements computed from a long stats range (the last year). Each one reports progress
// toward its target and, once reached, the day it was unlocked.
import type { DayStats, StatsResponse } from "./apiTypes"
import { simulateStreaks } from "./streaks"

export interface Achievement {
  id: string
  title: string
  description: string
  icon: "flame" | "drop" | "steps" | "dumbbell" | "trophy" | "check" | "brain" | "moon" | "mail" | "leaf"
  target: number
  value: number // best so far (run length or total)
  unlockedOn: string | null
}

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

// Longest run of consecutive days matching `ok`, and the day it first reached `target`
function runStats(days: DayStats[], ok: (d: DayStats) => boolean, target: number) {
  let run = 0
  let best = 0
  let unlockedOn: string | null = null
  for (const d of days) {
    run = ok(d) ? run + 1 : 0
    best = Math.max(best, run)
    if (!unlockedOn && run >= target) unlockedOn = d.date
  }
  return { best, unlockedOn }
}

function totalStats(days: DayStats[], value: (d: DayStats) => number, target: number) {
  let total = 0
  let unlockedOn: string | null = null
  for (const d of days) {
    total += value(d)
    if (!unlockedOn && total >= target) unlockedOn = d.date
  }
  return { best: total, unlockedOn }
}

export function computeAchievements(data: StatsResponse, today: string): Achievement[] {
  const days = data.days.filter((d) => d.date <= today)
  const t = data.targets
  const out: Achievement[] = []
  const add = (a: Omit<Achievement, "value" | "unlockedOn">, r: { best: number; unlockedOn: string | null }) =>
    out.push({ ...a, value: Math.min(r.best, a.target), unlockedOn: r.unlockedOn })

  // Habit streaks, with the same freeze rules as Stats
  const daily = data.habits.filter((h) => h.frequency !== "Weekly")
  if (daily.length) {
    const sets = daily.map((h) => new Set(h.completedDates))
    const perfect = (date: string) => sets.every((s) => s.has(date))
    const freezes = t.freezesPerMonth ?? 1
    for (const [target, title, description] of [
      [7, "Semana perfecta", "7 días seguidos con todos tus hábitos diarios"],
      [30, "Mes de hierro", "30 días seguidos de racha"],
      [100, "Imparable", "100 días seguidos de racha"],
    ] as const) {
      // Walk day by day to find when the streak first reached the target
      let unlockedOn: string | null = null
      let best = 0
      for (let d = data.from; d <= today && !unlockedOn; d = addDays(d, 1)) {
        const r = simulateStreaks(perfect, data.from, d, { today, freezesPerMonth: freezes })
        best = Math.max(best, r.current)
        if (r.current >= target) unlockedOn = d
      }
      if (!unlockedOn) best = Math.max(best, simulateStreaks(perfect, data.from, today, { today, freezesPerMonth: freezes }).best)
      add({ id: `streak-${target}`, title, description, icon: "flame", target }, { best, unlockedOn })
    }
  }

  add({ id: "water-14", title: "Bien hidratado", description: "14 días seguidos llegando al objetivo de agua", icon: "drop", target: 14 }, runStats(days, (d) => d.water >= t.water, 14))
  if (days.some((d) => d.steps != null)) {
    add({ id: "steps-7", title: "Caminante", description: `7 días seguidos con ${(t.steps ?? 10000).toLocaleString("es-AR")} pasos`, icon: "steps", target: 7 }, runStats(days, (d) => (d.steps ?? 0) >= (t.steps ?? 10000), 7))
    add({ id: "steps-1m", title: "Un millón de pasos", description: "1.000.000 de pasos acumulados", icon: "steps", target: 1_000_000 }, totalStats(days, (d) => d.steps ?? 0, 1_000_000))
  }
  add({ id: "protein-7", title: "Proteína al día", description: "7 días seguidos llegando a tu proteína", icon: "leaf", target: 7 }, runStats(days, (d) => (d.protein ?? 0) >= (t.protein ?? 9999), 7))
  add(
    { id: "calories-14", title: "En la zona", description: "14 días seguidos dentro de ±10% de tus calorías", icon: "check", target: 14 },
    runStats(days, (d) => d.mealsLogged > 0 && Math.abs(d.calories - t.calories) <= t.calories * 0.1, 14),
  )
  for (const [target, title] of [[10, "Constancia"], [50, "Cincuenta sesiones"], [150, "Atleta"]] as const) {
    add({ id: `active-${target}`, title, description: `${target} días con entrenamiento`, icon: "dumbbell", target }, totalStats(days, (d) => (d.sportMinutes > 0 ? 1 : 0), target))
  }
  const firstLift = [...(data.lifts ?? [])].sort((a, b) => a.date.localeCompare(b.date))[0]
  out.push({ id: "first-pr", title: "Primer récord", description: "Registrá series y batí tu mejor marca", icon: "trophy", target: 1, value: firstLift ? 1 : 0, unlockedOn: firstLift?.date ?? null })
  add({ id: "tasks-100", title: "Cien tareas", description: "100 tareas completadas", icon: "check", target: 100 }, totalStats(days, (d) => d.tasksCompleted, 100))
  if (days.some((d) => (d.focusMin ?? 0) > 0)) {
    add({ id: "focus-50h", title: "Deep work", description: "50 horas de foco", icon: "brain", target: 3000 }, totalStats(days, (d) => d.focusMin ?? 0, 3000))
  }
  if (days.some((d) => d.sleepMin != null)) {
    add({ id: "sleep-7", title: "Bien descansado", description: "7 noches seguidas durmiendo tu objetivo", icon: "moon", target: 7 }, runStats(days, (d) => (d.sleepMin ?? 0) >= (t.sleepMin ?? 450), 7))
  }
  if (days.some((d) => d.inboxTotal != null)) {
    add({ id: "inbox-10", title: "Bandeja bajo control", description: "Terminá un día con menos de 10 mails en la bandeja", icon: "mail", target: 1 }, totalStats(days, (d) => (d.inboxTotal != null && d.inboxTotal < 10 ? 1 : 0), 1))
  }

  // Unlocked first (most recent first), then by progress
  return out.sort((a, b) =>
    a.unlockedOn && b.unlockedOn ? b.unlockedOn.localeCompare(a.unlockedOn) : a.unlockedOn ? -1 : b.unlockedOn ? 1 : b.value / b.target - a.value / a.target,
  )
}
