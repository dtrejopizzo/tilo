"use client"

import type { DayData, RoutineItem, WorkoutSet } from "@tilo/core/apiTypes"
import { platesPerSide, volume } from "@tilo/core/training"
import { Check, Plus, Trash2 } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { crud, fmt, localDate, tilo } from "@/lib/client/api"
import { useToast } from "@/lib/client/toast"
import { invalidateDay } from "@/lib/client/useDay"

interface Block {
  exerciseId: string
  name: string
  target: string | null
  restSec: number
  planned: number
  last: RoutineItem["last"]
  suggestedKg: number | null
}

interface Draft {
  weight: string
  reps: string
  rpe: string
}

function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {})
    return () => void lock?.release().catch(() => {})
  }, [])
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  return <span className="clock">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>
}

export function WorkoutScreen({ id }: { id: string }) {
  const params = useSearchParams()
  const date = params.get("date") ?? localDate()
  const router = useRouter()
  const { toast } = useToast()
  useWakeLock()

  const [day, setDay] = useState<DayData | null>(null)
  const [exercises, setExercises] = useState<{ id: string; name: string; name_es: string | null; kind: string }[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [extra, setExtra] = useState<Block[]>([])
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [summary, setSummary] = useState<{ volume: number; sets: number; minutes: number } | null>(null)
  const addInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => tilo.getDay(date).then(setDay), [date])
  useEffect(() => {
    void load()
    tilo.request<{ exercises: typeof exercises }>("GET", "/catalog").then((c) => setExercises(c.exercises)).catch(() => {})
  }, [load])

  useEffect(() => {
    if (!rest) return
    const t = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= rest.until) {
        navigator.vibrate?.([200, 100, 200])
        setRest(null)
      }
    }, 250)
    return () => clearInterval(t)
  }, [rest])

  const workout = day?.workouts.find((w) => w.id === id) ?? null
  const blocks: Block[] = useMemo(() => {
    if (!day || !workout) return []
    const fromRoutine: Block[] =
      day.routine && (workout.routine_id === day.routine.id || !workout.routine_id)
        ? day.routine.items.map((i) => ({
            exerciseId: i.exercise_id, name: i.exercise.name,
            target: `${i.sets} × ${i.reps_min && i.reps_max && i.reps_min !== i.reps_max ? `${i.reps_min}-${i.reps_max}` : i.reps_max ?? i.reps_min ?? "AMRAP"}`,
            restSec: i.rest_sec, planned: i.sets, last: i.last, suggestedKg: null,
          }))
        : []
    const seen = new Set(fromRoutine.map((b) => b.exerciseId))
    const logged: Block[] = []
    for (const s of workout.sets) {
      if (!seen.has(s.exercise_id)) {
        seen.add(s.exercise_id)
        logged.push({ exerciseId: s.exercise_id, name: s.exercise_name, target: null, restSec: 120, planned: 1, last: null, suggestedKg: null })
      }
    }
    return [...fromRoutine, ...logged, ...extra.filter((b) => !seen.has(b.exerciseId))]
  }, [day, workout, extra])

  if (!day) return <main className="workout"><p className="hint">Cargando…</p></main>
  if (!workout) return <main className="workout"><p className="hint">No encontramos ese entrenamiento.</p></main>

  const setsFor = (exerciseId: string) => workout.sets.filter((s) => s.exercise_id === exerciseId).sort((a, b) => a.set_no - b.set_no)
  const draftKey = (b: Block, n: number) => `${b.exerciseId}:${n}`
  const draftFor = (b: Block, n: number): Draft => {
    const k = draftKey(b, n)
    if (drafts[k]) return drafts[k]
    const prev = b.last?.[n] ?? b.last?.at(-1)
    const done = setsFor(b.exerciseId)
    const lastDone = done.at(-1)
    return {
      weight: String(lastDone?.weight_kg ?? prev?.weight_kg ?? ""),
      reps: String(prev?.reps ?? lastDone?.reps ?? ""),
      rpe: "",
    }
  }

  async function logSet(b: Block, n: number) {
    const d = draftFor(b, n)
    const weight = Number(d.weight.replace(",", ".")) || 0
    const reps = Number(d.reps) || 0
    if (!reps) return toast("Poné las repeticiones", { error: true })
    try {
      const r = await tilo.addSet(id, { exercise_id: b.exerciseId, weight_kg: weight, reps, rpe: d.rpe ? Number(d.rpe.replace(",", ".")) : undefined })
      if (r.records?.e1rm) toast(`¡Récord en ${b.name}! ${weight} kg × ${reps}`)
      setRest({ until: Date.now() + b.restSec * 1000, total: b.restSec })
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true })
    }
  }

  async function editSet(s: WorkoutSet, patch: Partial<WorkoutSet>) {
    await crud.update("workout_sets", s.id, patch)
    await load()
  }

  async function finish() {
    const w = await tilo.finishWorkout(id)
    const work = w.sets.filter((s) => !s.is_warmup)
    setSummary({
      volume: volume(work.map((s) => ({ weightKg: Number(s.weight_kg ?? 0), reps: s.reps ?? 0 }))),
      sets: work.length,
      minutes: Math.round((Date.parse(w.ended_at!) - Date.parse(w.started_at)) / 60000),
    })
    invalidateDay(date)
  }

  if (summary) {
    return (
      <main className="workout">
        <div className="wo-head"><div><div className="hint">Resumen</div><h2>{workout.name} terminado</h2></div></div>
        <section className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
          <div className="kpi"><div className="lbl">Volumen</div><div className="val">{fmt(summary.volume)}<small> kg</small></div></div>
          <div className="kpi"><div className="lbl">Series</div><div className="val">{summary.sets}</div></div>
          <div className="kpi"><div className="lbl">Duración</div><div className="val">{summary.minutes}<small> min</small></div></div>
        </section>
        <p className="hint">Si grabaste la sesión en el reloj, la unimos sola a este entrenamiento para no contar las calorías dos veces.</p>
        <button className="btn leaf" onClick={() => router.push(date === localDate() ? "/" : `/?date=${date}`)}>Volver a Today</button>
      </main>
    )
  }

  const restLeft = rest ? Math.max(0, Math.ceil((rest.until - now) / 1000)) : 0

  return (
    <main className="workout">
      <div className="wo-head">
        <div><div className="hint">{blocks.length} ejercicios</div><h2>{workout.name}</h2></div>
        {workout.ended_at ? <span className="pill leaf">terminado</span> : <Elapsed since={workout.started_at} />}
      </div>

      {blocks.map((b) => {
        const done = setsFor(b.exerciseId)
        const rows = Math.max(b.planned, done.length + (workout.ended_at ? 0 : 1))
        const current = draftFor(b, done.length)
        const plates = Number(current.weight) > 20 ? platesPerSide(Number(current.weight)) : null
        return (
          <section key={b.exerciseId} className="card">
            <header>
              <h3>{b.name}</h3>
              {b.target && <span className="meta mono">{b.target}</span>}
            </header>
            <div className="setgrid h"><span>#</span><span>anterior</span><span>kg</span><span>reps</span><span>RPE</span><span /></div>
            {Array.from({ length: rows }, (_, n) => {
              const s = done[n]
              const prev = b.last?.[n]
              if (s) {
                return (
                  <div key={s.id} className="setgrid done">
                    <span className="setno">{n + 1}</span>
                    <span className="prev">{prev ? `${Number(prev.weight_kg ?? 0)} × ${prev.reps}` : "—"}</span>
                    <input defaultValue={Number(s.weight_kg ?? 0)} inputMode="decimal" aria-label="kg" onBlur={(e) => Number(e.target.value) !== Number(s.weight_kg) && editSet(s, { weight_kg: Number(e.target.value) })} />
                    <input defaultValue={s.reps ?? ""} inputMode="numeric" aria-label="reps" onBlur={(e) => Number(e.target.value) !== s.reps && editSet(s, { reps: Number(e.target.value) })} />
                    <input defaultValue={s.rpe ?? ""} inputMode="decimal" aria-label="RPE" onBlur={(e) => editSet(s, { rpe: e.target.value ? Number(e.target.value) : null })} />
                    <button className="ok" aria-label="Borrar serie" onClick={() => crud.remove("workout_sets", s.id).then(load)}><Trash2 /></button>
                  </div>
                )
              }
              const d = draftFor(b, n)
              const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [draftKey(b, n)]: { ...d, ...patch } })
              return (
                <div key={`d${n}`} className="setgrid">
                  <span className="setno">{n + 1}</span>
                  <span className="prev">{prev ? `${Number(prev.weight_kg ?? 0)} × ${prev.reps}` : "—"}</span>
                  <input value={d.weight} inputMode="decimal" aria-label="kg" onChange={(e) => set({ weight: e.target.value })} />
                  <input value={d.reps} inputMode="numeric" aria-label="reps" onChange={(e) => set({ reps: e.target.value })} />
                  <input value={d.rpe} inputMode="decimal" aria-label="RPE" placeholder="–" onChange={(e) => set({ rpe: e.target.value })} />
                  <button className="ok" aria-label="Serie hecha" onClick={() => logSet(b, n)} disabled={!!workout.ended_at}><Check /></button>
                </div>
              )
            })}
            {plates && plates.perSide.length > 0 && (
              <div className="plates">{fmt(plates.achievedKg)} kg = barra 20 + por lado: {plates.perSide.join(" · ")}</div>
            )}
          </section>
        )
      })}

      {!workout.ended_at && (
        <>
          <form
            className="card"
            style={{ display: "flex", gap: 6, padding: 8 }}
            onSubmit={(e) => {
              e.preventDefault()
              const v = addInput.current?.value.trim().toLowerCase()
              const ex = exercises.find((x) => (x.name_es ?? x.name).toLowerCase() === v)
              if (!ex) return toast("Elegí un ejercicio de la lista", { error: true })
              setExtra([...extra, { exerciseId: ex.id, name: ex.name_es ?? ex.name, target: null, restSec: 120, planned: 3, last: null, suggestedKg: null }])
              addInput.current!.value = ""
            }}
          >
            <datalist id="wo-exercises">{exercises.map((x) => <option key={x.id} value={x.name_es ?? x.name} />)}</datalist>
            <input ref={addInput} className="input" list="wo-exercises" placeholder="Agregar ejercicio" aria-label="Agregar ejercicio" />
            <button className="btn ghost sm"><Plus /> Agregar</button>
          </form>
          <button className="btn leaf" onClick={finish}>Terminar entrenamiento</button>
        </>
      )}

      {rest && (
        <div className="rest" role="timer" aria-live="polite">
          <span className="hint" style={{ color: "inherit", opacity: 0.7 }}>Descanso</span>
          <span className="t">{Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, "0")}</span>
          <div className="bar"><i style={{ width: `${100 - (restLeft / rest.total) * 100}%` }} /></div>
          <button className="btn ghost sm" onClick={() => setRest({ ...rest, until: rest.until + 30_000, total: rest.total + 30 })}>+30 s</button>
          <button className="btn ghost sm" onClick={() => setRest(null)}>Saltar</button>
        </div>
      )}
    </main>
  )
}
