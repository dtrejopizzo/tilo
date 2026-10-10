import { describe, expect, it } from "vitest"
import type { StatsResponse } from "./apiTypes"
import { buildMonthStats, fetchRange, monthBounds, shiftMonth } from "./stats"
import { renderStatsBody } from "./statsHtml"

const TODAY = "2026-10-07"

function day(date: string, overrides: Partial<StatsResponse["days"][number]> = {}) {
  return { date, tasksCompleted: 0, water: 0, calories: 0, mealsLogged: 0, sportMinutes: 0, ...overrides }
}

function dates(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

// Two daily habits done every day from Sep 28 to Oct 6, one weekly habit, nothing today yet
function sample(month = "2026-10"): StatsResponse {
  const { from, to } = fetchRange(month)
  const streak = dates("2026-09-28", "2026-10-06")
  return {
    from,
    to,
    targets: { calories: 2000, water: 2500 },
    days: dates(from, to).map((date) =>
      day(date, date === "2026-10-05" ? { tasksCompleted: 6, water: 2600, calories: 2100, mealsLogged: 3, sportMinutes: 45 } : {}),
    ),
    habits: [
      { id: "a", name: "Meditate", frequency: "Daily", completedDates: streak },
      { id: "b", name: "Read", frequency: "Daily", completedDates: streak },
      { id: "c", name: "English", frequency: "Weekly", completedDates: ["2026-10-02"] },
    ],
    weight: [
      { date: "2026-10-01", value: 79.4 },
      { date: "2026-10-06", value: 78.9 },
    ],
  }
}

describe("month helpers", () => {
  it("computes month bounds, including leap years", () => {
    expect(monthBounds("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })

  it("shifts months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
  })

  it("fetches extra days before the month for streaks", () => {
    expect(fetchRange("2026-10").from < "2026-10-01").toBe(true)
  })
})

describe("buildMonthStats", () => {
  const stats = buildMonthStats("2026-10", sample(), TODAY)

  it("only includes the month's days and marks future ones", () => {
    expect(stats.days).toHaveLength(31)
    expect(stats.elapsed).toHaveLength(7)
    expect(stats.days.find((d) => d.date === TODAY)?.isToday).toBe(true)
    expect(stats.days.find((d) => d.date === "2026-10-08")?.future).toBe(true)
  })

  it("counts a streak that started in the previous month, ignoring an unfinished today", () => {
    expect(stats.kpis.streak.current).toBe(9)
    expect(stats.kpis.streak.best).toBe(9) // a streak running into this month counts in full
  })

  it("only counts daily habits toward completion", () => {
    expect(stats.dailyHabitCount).toBe(2)
    expect(stats.kpis.habitRate).toBeCloseTo(12 / 14)
    expect(stats.kpis.perfectDays).toBe(6)
  })

  it("summarises tasks, water, calories, sport and weight", () => {
    expect(stats.kpis.tasks.total).toBe(6)
    expect(stats.kpis.tasks.busiest?.date).toBe("2026-10-05")
    expect(stats.kpis.water.daysOnTarget).toBe(1)
    expect(stats.kpis.calories).toEqual({ avg: 2100, loggedDays: 1, daysOnTarget: 1 })
    expect(stats.kpis.sport).toEqual({ minutes: 45, activeDays: 1 })
    expect(stats.kpis.weight?.latest).toBe(78.9)
    expect(stats.kpis.weight?.change).toBeCloseTo(-0.5)
  })

  it("reports a past month's best streak without a current one", () => {
    const sep = buildMonthStats("2026-09", sample("2026-09"), TODAY)
    expect(sep.isCurrentMonth).toBe(false)
    expect(sep.kpis.streak.current).toBeNull()
    expect(sep.kpis.streak.best).toBe(3)
  })
})

describe("renderStatsBody", () => {
  it("renders every section and escapes habit names", () => {
    const data = sample()
    data.habits[0].name = "<script>x</script>"
    const html = renderStatsBody(buildMonthStats("2026-10", data, TODAY))
    for (const title of ["Hábitos", "Tareas completadas", "Agua", "Calorías", "Actividad"]) {
      expect(html).toContain(`<h2>${title}</h2>`)
    }
    expect(html).not.toContain("<script>x</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("disables the next-month button on the current month", () => {
    const html = renderStatsBody(buildMonthStats("2026-10", sample(), TODAY))
    expect(html).toMatch(/data-action="next"[^>]*disabled/)
  })
})

describe("streak freezes", () => {
  it("a monthly freeze saves one missed day, and a second miss breaks the streak", async () => {
    const { simulateStreaks } = await import("./streaks")
    const missed = new Set(["2026-10-03", "2026-10-05"])
    const perfect = (d: string) => !missed.has(d)
    const r = simulateStreaks(perfect, "2026-10-01", "2026-10-07", { today: "2026-10-07", freezesPerMonth: 1 })
    expect([...r.frozen]).toEqual(["2026-10-03"])
    expect(r.current).toBe(2) // Oct 6–7 after the unprotected miss on the 5th
    const two = simulateStreaks(perfect, "2026-10-01", "2026-10-07", { today: "2026-10-07", freezesPerMonth: 2 })
    expect(two.current).toBe(5)
    expect(two.frozen.size).toBe(2)
  })

  it("gives the freeze back when the streak dies right after it", async () => {
    const { simulateStreaks } = await import("./streaks")
    const missed = new Set(["2026-10-03", "2026-10-04"])
    const r = simulateStreaks((d) => !missed.has(d), "2026-10-01", "2026-10-07", { today: "2026-10-08", freezesPerMonth: 1 })
    expect(r.frozen.size).toBe(0)
    expect(r.usedByMonth.get("2026-10")).toBe(0)
  })

  it("protects yesterday for the current streak", async () => {
    const { simulateStreaks } = await import("./streaks")
    const r = simulateStreaks((d) => d !== "2026-10-07", "2026-10-01", "2026-10-08", { today: "2026-10-08", freezesPerMonth: 1 })
    expect(r.current).toBe(7) // Oct 1–6 plus today, with the 7th frozen
    expect([...r.frozen]).toEqual(["2026-10-07"])
  })
})

describe("achievements", () => {
  it("unlocks streak and water achievements and reports progress", async () => {
    const { computeAchievements } = await import("./achievements")
    const days = dates("2026-09-01", "2026-10-07")
    const a = computeAchievements(
      {
        from: "2026-09-01", to: "2026-10-07", targets: { calories: 2000, water: 2500, protein: 150, freezesPerMonth: 1 },
        days: days.map((date) => day(date, { water: 2600, sportMinutes: date.endsWith("5") ? 40 : 0 })),
        habits: [{ id: "a", name: "Meditar", frequency: "Daily", completedDates: days.filter((d) => d !== "2026-09-20") }],
        weight: [],
      },
      "2026-10-07",
    )
    const byId = Object.fromEntries(a.map((x) => [x.id, x]))
    expect(byId["streak-7"].unlockedOn).toBe("2026-09-07")
    expect(byId["streak-30"].unlockedOn).not.toBeNull() // the miss on Sep 20 is covered by the freeze
    expect(byId["water-14"].unlockedOn).toBe("2026-09-14")
    expect(byId["active-10"].unlockedOn).toBeNull()
    expect(byId["active-10"].value).toBe(4)
  })

  it("renders frozen days, sleep and achievements", async () => {
    const { computeAchievements } = await import("./achievements")
    const data = sample()
    data.days = data.days.map((d) => ({ ...d, sleepMin: 430 }))
    data.targets.sleepMin = 450
    const html = renderStatsBody(buildMonthStats("2026-10", data, TODAY), { achievements: computeAchievements(data, TODAY) })
    expect(html).toContain("<h2>Sueño</h2>")
    expect(html).toContain("<h2>Logros</h2>")
    expect(html).toContain("Sueño / noche")
  })
})
