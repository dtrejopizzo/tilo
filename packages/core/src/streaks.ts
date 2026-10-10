// Streaks of "perfect days" (every daily habit done) with streak freezes: a monthly allowance
// of missed days that don't break the streak. A freeze only sticks if the streak continues
// after it (or it is protecting the current streak); otherwise it is given back.

export interface StreakResult {
  current: number // perfect days in the streak running up to `end` (today doesn't break it yet)
  best: number // longest streak whose days fall in [countFrom, end]
  frozen: Set<string> // days saved by a freeze
  usedByMonth: Map<string, number> // YYYY-MM → freezes used
}

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

export function simulateStreaks(
  isPerfect: (date: string) => boolean,
  from: string,
  end: string,
  opts: { today: string; freezesPerMonth: number; countFrom?: string },
): StreakResult {
  const frozen = new Set<string>()
  const usedByMonth = new Map<string, number>()
  let pending: string[] = [] // freezes since the last perfect day
  let run = 0
  let best = 0
  const countFrom = opts.countFrom ?? from

  const release = () => {
    for (const d of pending) {
      frozen.delete(d)
      usedByMonth.set(d.slice(0, 7), (usedByMonth.get(d.slice(0, 7)) ?? 1) - 1)
    }
    pending = []
  }

  for (let date = from; date <= end; date = addDays(date, 1)) {
    if (isPerfect(date)) {
      run++
      pending = []
      if (date >= countFrom) best = Math.max(best, run)
      continue
    }
    if (date === opts.today) continue // today isn't over yet
    const month = date.slice(0, 7)
    const used = usedByMonth.get(month) ?? 0
    if (run > 0 && used < opts.freezesPerMonth) {
      usedByMonth.set(month, used + 1)
      frozen.add(date)
      pending.push(date)
    } else {
      release()
      run = 0
    }
  }
  return { current: run, best, frozen, usedByMonth }
}

export function longestRun(dates: string[], predicate: (date: string) => boolean): number {
  let run = 0
  let best = 0
  for (const d of dates) {
    run = predicate(d) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}
