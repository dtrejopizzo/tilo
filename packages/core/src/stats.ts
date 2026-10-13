import type { DayStats, RangeData, StatsResponse } from "./apiTypes"
import { pickMetrics, type DailyMetricRow, type MetricKey, type Source } from "./sources"
import { simulateStreaks } from "./streaks"

// Turns a /stats response into what the dashboard shows for one month.
// No vscode imports, so it can also run in a browser preview.

const STREAK_LOOKBACK_DAYS = 45

export interface StatsDay extends DayStats {
  day: number // day of month, 1-31
  weekday: number // 0 = Monday … 6 = Sunday
  future: boolean
  isToday: boolean
  habitsDone: number // daily habits done that day
}

export interface HabitRow {
  id: string
  name: string
  frequency: "Daily" | "Weekly"
  done: Set<string>
  count: number // completions this month
}

export interface MonthStats {
  month: string // YYYY-MM
  label: string // e.g. "Octubre 2026"
  today: string
  isCurrentMonth: boolean
  days: StatsDay[] // every day of the month
  elapsed: StatsDay[] // days up to today
  dailyHabitCount: number
  habits: HabitRow[]
  targets: StatsResponse["targets"]
  kpis: {
    habitRate: number | null // 0-1, daily habits done / possible
    perfectDays: number
    streak: { current: number | null; best: number; freezesUsed: number; freezesPerMonth: number }
    sleep: { avg: number; daysOnTarget: number; days: number } | null
    tasks: { total: number; busiest: StatsDay | null }
    water: { avg: number; daysOnTarget: number }
    calories: { avg: number | null; loggedDays: number; daysOnTarget: number }
    sport: { minutes: number; activeDays: number }
    weight: { latest: number; change: number | null } | null
    steps: { avg: number; daysOnTarget: number; days: number } | null
    balance: { avg: number; days: number } | null // intake − expenditure, days with both
    training: { sets: number; volumeKg: number; workoutDays: number } | null
    inbox: { latest: number; change: number; personalShare: number | null } | null
    focus: { minutes: number; days: number } | null
  }
  frozen: Set<string> // days a streak freeze saved
  muscles: { muscle: string; sets: number; perWeek: number }[]
  lifts: NonNullable<StatsResponse["lifts"]>
}

const pad = (n: number) => String(n).padStart(2, "0")

function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` }
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

// The range to request: the month plus some earlier days so streaks can cross months
export function fetchRange(month: string): { from: string; to: string } {
  const { from, to } = monthBounds(month)
  return { from: addDays(from, -STREAK_LOOKBACK_DAYS), to }
}

export function buildMonthStats(month: string, data: StatsResponse, today: string): MonthStats {
  const { from, to } = monthBounds(month)
  const [y, m] = month.split("-").map(Number)
  const dailyHabits = data.habits.filter((h) => h.frequency !== "Weekly")
  const doneSets = new Map(data.habits.map((h) => [h.id, new Set(h.completedDates)]))
  const weekdayOf = (date: string) => (new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay() + 6) % 7
  // Daily habits expected on a date: those scheduled for its weekday (rest days don't count against you)
  const scheduled = (date: string) => {
    const wd = weekdayOf(date)
    return dailyHabits.filter((h) => !h.days || h.days.includes(wd))
  }
  const dailyDone = (date: string) => scheduled(date).filter((h) => doneSets.get(h.id)!.has(date)).length
  const isPerfect = (date: string) => dailyHabits.length > 0 && dailyDone(date) === scheduled(date).length

  const days: StatsDay[] = data.days
    .filter((d) => d.date >= from && d.date <= to)
    .map((d) => {
      const day = Number(d.date.slice(8))
      return {
        ...d,
        day,
        weekday: (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7,
        future: d.date > today,
        isToday: d.date === today,
        habitsDone: dailyDone(d.date),
      }
    })
  const elapsed = days.filter((d) => !d.future)

  // Streaks with freezes: the current one may start before this month; today only counts once complete
  const isCurrentMonth = today.slice(0, 7) === month
  const freezesPerMonth = data.targets.freezesPerMonth ?? 1
  const end = to < today ? to : today
  const streak =
    dailyHabits.length > 0
      ? simulateStreaks(isPerfect, data.from, end, { today, freezesPerMonth, countFrom: from })
      : { current: 0, best: 0, frozen: new Set<string>(), usedByMonth: new Map<string, number>() }
  const current = isCurrentMonth && dailyHabits.length > 0 ? streak.current : null
  const best = streak.best

  const possible = elapsed.reduce((s, d) => s + scheduled(d.date).length, 0)
  const loggedMeals = elapsed.filter((d) => d.mealsLogged > 0)
  const busiest = elapsed.reduce<StatsDay | null>(
    (top, d) => (d.tasksCompleted > (top?.tasksCompleted ?? 0) ? d : top),
    null,
  )
  const weights = data.weight.filter((w) => w.date >= from && w.date <= to)
  const withSteps = elapsed.filter((d) => d.steps != null && d.steps > 0)
  const withBalance = elapsed.filter((d) => d.kcalOut != null && d.mealsLogged > 0)
  const withInbox = elapsed.filter((d) => d.inboxTotal != null)
  const withFocus = elapsed.filter((d) => (d.focusMin ?? 0) > 0)
  const monthMuscles = (data.muscles ?? []).filter((m) => m.date >= from && m.date <= to)
  const muscleTotals = new Map<string, number>()
  for (const m of monthMuscles) muscleTotals.set(m.muscle, (muscleTotals.get(m.muscle) ?? 0) + m.sets)
  const weeks = Math.max(1, elapsed.length / 7)

  return {
    month,
    label: (() => {
      const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("es-AR", { month: "long", timeZone: "UTC" })
      return `${name[0].toUpperCase()}${name.slice(1)} ${y}`
    })(),
    today,
    isCurrentMonth,
    days,
    elapsed,
    dailyHabitCount: dailyHabits.length,
    habits: data.habits.map((h) => {
      const done = new Set(h.completedDates.filter((date) => date >= from && date <= to))
      return { id: h.id, name: h.name, frequency: h.frequency, done, count: done.size }
    }),
    targets: data.targets,
    kpis: {
      habitRate: possible > 0 ? elapsed.reduce((s, d) => s + d.habitsDone, 0) / possible : null,
      perfectDays: elapsed.filter((d) => isPerfect(d.date)).length,
      streak: { current, best, freezesUsed: streak.usedByMonth.get(month) ?? 0, freezesPerMonth },
      sleep: (() => {
        const nights = elapsed.filter((d) => (d.sleepMin ?? 0) > 0)
        if (!nights.length) return null
        return {
          avg: nights.reduce((s, d) => s + (d.sleepMin ?? 0), 0) / nights.length,
          daysOnTarget: nights.filter((d) => (d.sleepMin ?? 0) >= (data.targets.sleepMin ?? 450)).length,
          days: nights.length,
        }
      })(),
      tasks: { total: elapsed.reduce((s, d) => s + d.tasksCompleted, 0), busiest },
      water: {
        avg: elapsed.length ? elapsed.reduce((s, d) => s + d.water, 0) / elapsed.length : 0,
        daysOnTarget: elapsed.filter((d) => d.water >= data.targets.water).length,
      },
      calories: {
        avg: loggedMeals.length ? loggedMeals.reduce((s, d) => s + d.calories, 0) / loggedMeals.length : null,
        loggedDays: loggedMeals.length,
        daysOnTarget: loggedMeals.filter((d) => Math.abs(d.calories - data.targets.calories) <= data.targets.calories * 0.1)
          .length,
      },
      sport: {
        minutes: elapsed.reduce((s, d) => s + d.sportMinutes, 0),
        activeDays: elapsed.filter((d) => d.sportMinutes > 0).length,
      },
      weight: weights.length
        ? {
            latest: weights[weights.length - 1].value,
            change: weights.length > 1 ? weights[weights.length - 1].value - weights[0].value : null,
          }
        : null,
      steps: withSteps.length
        ? {
            avg: withSteps.reduce((s, d) => s + (d.steps ?? 0), 0) / withSteps.length,
            daysOnTarget: withSteps.filter((d) => (d.steps ?? 0) >= (data.targets.steps ?? 10000)).length,
            days: withSteps.length,
          }
        : null,
      balance: withBalance.length
        ? { avg: withBalance.reduce((s, d) => s + d.calories - (d.kcalOut ?? 0), 0) / withBalance.length, days: withBalance.length }
        : null,
      training: monthMuscles.length
        ? {
            sets: monthMuscles.reduce((s, m) => s + m.sets, 0),
            volumeKg: monthMuscles.reduce((s, m) => s + m.volumeKg, 0),
            workoutDays: new Set(monthMuscles.map((m) => m.date)).size,
          }
        : null,
      inbox: withInbox.length
        ? {
            latest: withInbox[withInbox.length - 1].inboxTotal!,
            change: withInbox[withInbox.length - 1].inboxTotal! - withInbox[0].inboxTotal!,
            personalShare: (() => {
              const p = withInbox.reduce((s, d) => s + (d.personalMail ?? 0), 0)
              const n = withInbox.reduce((s, d) => s + (d.newsletters ?? 0), 0)
              return p + n > 0 ? p / (p + n) : null
            })(),
          }
        : null,
      focus: withFocus.length ? { minutes: withFocus.reduce((s, d) => s + (d.focusMin ?? 0), 0), days: withFocus.length } : null,
    },
    frozen: new Set([...streak.frozen].filter((d) => d >= from && d <= to)),
    muscles: [...muscleTotals.entries()]
      .map(([muscle, sets]) => ({ muscle, sets, perWeek: Math.round((sets / weeks) * 10) / 10 }))
      .sort((a, b) => b.sets - a.sets),
    lifts: (data.lifts ?? []).slice(0, 8),
  }
}

// Converts a get_range() response into the stats model, picking the best source per day
export function rangeToStats(
  range: RangeData,
  opts: { priority?: Source[]; pinned?: Partial<Record<MetricKey, Source>> } = {},
): StatsResponse {
  const by = <T extends { date: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), r])
    return m
  }
  const summaries = new Map(range.summaries.map((s) => [s.date, s]))
  const metrics = by(range.metrics)
  const energy = new Map(range.energy.map((e) => [e.date, e]))
  const email = new Map(range.email.map((e) => [e.date, e]))
  const focus = new Map(range.focus.map((f) => [f.date, f.minutes]))
  const days: DayStats[] = []
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const s = summaries.get(date)
    const m = metrics.get(date) ? pickMetrics(metrics.get(date)! as DailyMetricRow[], opts.priority, opts.pinned).values : {}
    const e = email.get(date)
    days.push({
      date,
      tasksCompleted: s?.tasks_done ?? 0,
      water: s?.water_ml ?? 0,
      calories: Math.round(Number(s?.kcal_in ?? 0)),
      mealsLogged: s?.meals_count ?? 0,
      sportMinutes: s?.sport_min ?? 0,
      protein: Math.round(Number(s?.protein_g ?? 0)),
      steps: m.steps ?? null,
      sleepMin: m.sleep_min ?? null,
      kcalOut: energy.get(date)?.total ?? null,
      focusMin: focus.get(date) ?? 0,
      inboxTotal: e?.inbox_total ?? null,
      unread: e?.unread ?? null,
      personalMail: e?.personal ?? null,
      newsletters: e?.newsletters ?? null,
    })
  }
  return {
    from: range.from,
    to: range.to,
    targets: {
      calories: range.goals.kcal, water: range.goals.water_ml, steps: range.goals.steps,
      protein: range.goals.protein_g, weeklySets: range.goals.weekly_sets_target, sleepMin: range.goals.sleep_min,
      freezesPerMonth: Number((range.settings as { streak_freezes?: number } | null)?.streak_freezes ?? 1),
    },
    days,
    habits: range.habits.map((h) => ({
      id: h.id, name: h.name, frequency: h.frequency === "weekly" ? "Weekly" : "Daily", days: h.days, completedDates: h.dates,
    })),
    weight: range.weights.map((w) => ({ date: w.date, value: Number(w.kg) })),
    muscles: range.muscle_sets.map((m) => ({ date: m.date, muscle: m.muscle, sets: m.sets, volumeKg: Number(m.volume_kg) })),
    lifts: range.best_lifts.map((l) => ({ name: l.name, date: l.date, weightKg: Number(l.weight_kg), reps: l.reps, e1rm: Number(l.e1rm) })),
  }
}
