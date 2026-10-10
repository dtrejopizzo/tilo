// Strength-training math: estimated 1RM, records, progression and plates.

export interface SetRecord {
  weightKg: number
  reps: number
  rpe?: number | null
  isWarmup?: boolean
}

// Epley; reps above 12 are too unreliable for a 1RM estimate
export function e1rm(weightKg: number, reps: number): number | null {
  if (weightKg <= 0 || reps < 1 || reps > 12) return null
  return reps === 1 ? weightKg : Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

export function bestSet(sets: SetRecord[]): { set: SetRecord; e1rm: number } | null {
  let best: { set: SetRecord; e1rm: number } | null = null
  for (const set of sets) {
    if (set.isWarmup) continue
    const v = e1rm(set.weightKg, set.reps)
    if (v != null && (!best || v > best.e1rm)) best = { set, e1rm: v }
  }
  return best
}

export function volume(sets: SetRecord[]): number {
  return sets.filter((s) => !s.isWarmup).reduce((sum, s) => sum + s.weightKg * s.reps, 0)
}

export interface RecordCheck {
  e1rm: boolean
  weight: boolean
  volume: boolean
}

// Which records today's sets beat, given the previous bests for this exercise
export function checkRecords(today: SetRecord[], previous: { e1rm: number; maxWeight: number; maxVolume: number } | null): RecordCheck {
  const best = bestSet(today)
  const work = today.filter((s) => !s.isWarmup)
  const maxWeight = work.reduce((m, s) => Math.max(m, s.weightKg), 0)
  if (!previous) return { e1rm: best != null, weight: maxWeight > 0, volume: work.length > 0 }
  return {
    e1rm: best != null && best.e1rm > previous.e1rm,
    weight: maxWeight > previous.maxWeight,
    volume: volume(today) > previous.maxVolume,
  }
}

export interface ProgressionTarget {
  sets: number
  repsMin: number
  repsMax: number
  lowerBody: boolean
}

// Double progression: hit the top of the rep range on every work set at RPE ≤ 9 → add weight
export function suggestNext(last: SetRecord[], target: ProgressionTarget): { weightKg: number; note: string } | null {
  const work = last.filter((s) => !s.isWarmup)
  if (!work.length) return null
  const top = Math.max(...work.map((s) => s.weightKg))
  const atTop = work.filter((s) => s.weightKg === top)
  const step = target.lowerBody ? 5 : 2.5
  const allMax = atTop.length >= target.sets && atTop.every((s) => s.reps >= target.repsMax && (s.rpe == null || s.rpe <= 9))
  if (allMax) return { weightKg: top + step, note: `Llegaste a ${target.repsMax} reps en todas: subí ${step} kg` }
  const missed = atTop.some((s) => s.reps < target.repsMin)
  if (missed) {
    const hard = atTop.filter((s) => s.reps < target.repsMin).length >= 2
    return hard
      ? { weightKg: Math.round(top * 0.9 / 2.5) * 2.5, note: "Dos series por debajo del rango: bajá 10% y reconstruí" }
      : { weightKg: top, note: "Repetí el peso y apuntá a completar el rango" }
  }
  return { weightKg: top, note: `Mismo peso, sumá reps hasta ${target.repsMax}` }
}

export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]

// Plates per side for a target load, greedy from heaviest
export function platesPerSide(targetKg: number, barKg = 20, plates = DEFAULT_PLATES): { perSide: number[]; achievedKg: number } {
  let side = Math.max(0, (targetKg - barKg) / 2)
  const perSide: number[] = []
  for (const p of plates) {
    while (side + 1e-9 >= p) {
      perSide.push(p)
      side -= p
    }
  }
  return { perSide, achievedKg: barKg + perSide.reduce((s, p) => s + p, 0) * 2 }
}

// Training impulse from average heart rate (Banister), for cardio load
export function trimp(durationMin: number, avgHr: number, restingHr: number, maxHr: number, sex: "male" | "female" | null): number {
  const hrr = Math.min(1, Math.max(0, (avgHr - restingHr) / (maxHr - restingHr)))
  const k = sex === "female" ? 1.67 : 1.92
  return Math.round(durationMin * hrr * 0.64 * Math.exp(k * hrr))
}

// Acute (7 d) vs chronic (28 d) load ratio; 0.8–1.3 is the usual "sweet spot"
export function acwr(dailyLoads: number[]): number | null {
  if (dailyLoads.length < 28) return null
  const last = dailyLoads.slice(-28)
  const acute = last.slice(-7).reduce((s, v) => s + v, 0) / 7
  const chronic = last.reduce((s, v) => s + v, 0) / 28
  return chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null
}
