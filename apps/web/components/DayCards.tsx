"use client"

import type { DayData, Meal, Task } from "@tilo/core/apiTypes"
import type { TodayView } from "@tilo/core/today"
import { Check, Lightbulb, Mail, Pencil, Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { crud, fmt, litres, tilo } from "@/lib/client/api"
import type { useDay } from "@/lib/client/useDay"

type Mutate = ReturnType<typeof useDay>["mutate"]

export interface CardProps {
  date: string
  day: DayData
  view: TodayView
  mutate: Mutate
}

export function Checkbox({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button className="cbx" onClick={onClick} aria-pressed={done} aria-label={label}>
      <Check strokeWidth={3} />
    </button>
  )
}

function Card({ title, meta, actions, children }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header>
        <h3>{title}</h3>
        {meta && <span className="meta">{meta}</span>}
        <span className="spacer" />
        {actions}
      </header>
      <div className="body">{children}</div>
    </section>
  )
}

// ---------- KPIs ----------

export function Kpis({ view, date, mutate, day }: CardProps) {
  const e = view.energy
  const steps = view.metrics.values.steps
  const sleep = view.metrics.values.sleep_min ?? null
  const glass = Number((day.settings as { glass_ml?: number } | null)?.glass_ml ?? 250)
  const k = (lbl: string, val: ReactNode, sub: string, pct?: number, color?: string, onClick?: () => void, aria?: string) => {
    const inner = (
      <>
        <div className="lbl">{lbl}</div>
        <div className="val">{val}</div>
        <div className="sub">{sub}</div>
        {pct != null && <div className="bar"><i style={{ width: `${Math.min(100, pct)}%`, background: color }} /></div>}
      </>
    )
    return onClick ? <button className="kpi" onClick={onClick} aria-label={aria}>{inner}</button> : <div className="kpi">{inner}</div>
  }
  return (
    <section className="kpis" aria-label="Resumen del día">
      {k(
        "Balance",
        <span className={e.balance < 0 ? "good" : undefined}>{e.balance > 0 ? "+" : "−"}{fmt(Math.abs(e.balance))}<small> kcal</small></span>,
        `comiste ${fmt(e.intake)} · gastaste ${fmt(e.total)}`,
      )}
      {k("Pasos", steps != null ? fmt(steps) : "—", steps != null ? `objetivo ${fmt(view.stepsTarget)}` : "conectá un dispositivo", steps != null ? (steps / view.stepsTarget) * 100 : undefined, "var(--carbs)")}
      {k(
        "Agua",
        <>{litres(view.water.total)}<small>/{litres(view.water.target)} L</small></>,
        `+${glass} ml con un toque`,
        (view.water.total / view.water.target) * 100,
        "var(--carbs)",
        () => mutate((d) => ({ ...d, water: [...d.water, { id: "tmp", ml: glass, logged_at: new Date().toISOString() }] }), () => tilo.addWater(glass, date)),
        `Sumar ${glass} ml de agua`,
      )}
      {k("Proteína", <>{view.nutrition.protein}<small>/{view.nutrition.targets.protein} g</small></>, view.nutrition.protein >= view.nutrition.targets.protein ? "objetivo cumplido" : `faltan ${view.nutrition.targets.protein - view.nutrition.protein} g`, (view.nutrition.protein / view.nutrition.targets.protein) * 100, "var(--protein)")}
      {k("Checklist", <>{view.checklistDone}<small>/{view.checklistTotal}</small></>, "hábitos y suplementos", view.checklistTotal ? (view.checklistDone / view.checklistTotal) * 100 : undefined, "var(--leaf)")}
      {k(
        "Sueño",
        sleep != null ? <>{Math.floor(sleep / 60)}<small>h</small>{String(sleep % 60).padStart(2, "0")}</> : "—",
        sleep != null ? `objetivo ${Math.floor(day.goals.sleep_min / 60)} h ${String(day.goals.sleep_min % 60).padStart(2, "0")}` : "llega desde tu reloj",
        sleep != null ? (sleep / day.goals.sleep_min) * 100 : undefined,
        "var(--protein)",
      )}
    </section>
  )
}

const ddmm = (d: string) => d.slice(5).split("-").reverse().join("/")

// ---------- Agenda (calendar + tasks) ----------

interface CalEvent { id: string; title: string; start: string; end: string; allDay: boolean; meetLink: string | null }

type Priority = Task["priority"]

// Project (pick an existing one or type a new name), deadline and priority, shared by the new-task and edit forms
function TaskFields({ id, projects, project, setProject, due, setDue, priority, setPriority }: {
  id: string; projects: DayData["projects"]; project: string; setProject: (v: string) => void
  due: string; setDue: (v: string) => void; priority: Priority; setPriority: (v: Priority) => void
}) {
  return (
    <>
      <input className="input" list={`projects-${id}`} value={project} onChange={(e) => setProject(e.target.value)} placeholder="Proyecto" aria-label="Proyecto (elegí uno o escribí uno nuevo)" />
      <datalist id={`projects-${id}`}>{projects.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha límite" />
      <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label="Prioridad">
        <option value="high">Alta</option>
        <option value="medium">Media</option>
        <option value="low">Baja</option>
      </select>
    </>
  )
}

const taskGrid = { gridTemplateColumns: "minmax(0,1fr) 130px 140px 90px auto auto" }

function TaskRow({ t, date, mutate, projects }: { t: Task; date: string; mutate: Mutate; projects: DayData["projects"] }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [due, setDue] = useState(t.due_date ?? "")
  const [projectName, setProjectName] = useState(projects.find((p) => p.id === t.project_id)?.name ?? "")
  const [priority, setPriority] = useState<Priority>(t.priority)
  const done = t.status === "done"
  const overdue = !done && t.due_date && t.due_date < date
  const project = projects.find((p) => p.id === t.project_id)
  if (editing) {
    return (
      <form
        className="edit"
        style={taskGrid}
        onSubmit={(e) => {
          e.preventDefault()
          setEditing(false)
          void mutate(
            (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, title, due_date: due || null, priority } : x)) }),
            () => tilo.updateTask(t.id, { title, due_date: due || null, priority, project: projectName.trim() || null }, date),
          )
        }}
      >
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título" autoFocus />
        <TaskFields id={t.id} projects={projects} project={projectName} setProject={setProjectName} due={due} setDue={setDue} priority={priority} setPriority={setPriority} />
        <button className="btn leaf sm">Listo</button>
        <button
          type="button"
          className="iconbtn"
          aria-label="Borrar tarea"
          onClick={() => mutate((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }), () => tilo.request("DELETE", `/tasks/${t.id}`), "Tarea borrada")}
        >
          <Trash2 />
        </button>
      </form>
    )
  }
  return (
    <div className={`row${done ? " done" : ""}`}>
      <Checkbox
        done={done}
        label={done ? `Reabrir ${t.title}` : `Completar ${t.title}`}
        onClick={() =>
          mutate(
            (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status: done ? "todo" : "done", completed_on: done ? null : date } : x)) }),
            () => tilo.updateTask(t.id, { status: done ? "todo" : "done" }, date),
          )
        }
      />
      <button className="t" onClick={() => setEditing(true)}>{t.title}</button>
      {t.priority === "high" && !done && <span className="pill red">alta</span>}
      {t.priority === "low" && !done && <span className="d">baja</span>}
      {project && <span className="d">{project.name}</span>}
      {overdue ? <span className="pill red">vencida · {ddmm(t.due_date!)}</span> : t.due_date && t.due_date !== date && !done && <span className="d">{ddmm(t.due_date)}</span>}
      {t.source === "code" && <span className="pill auto">código</span>}
      {t.source === "email" && <span className="pill auto">mail</span>}
    </div>
  )
}

const calendarCache = new Map<string, { at: number; events: CalEvent[] }>()

export function AgendaCard({ date, day, view, mutate }: CardProps) {
  const [events, setEvents] = useState<CalEvent[]>(() => calendarCache.get(date)?.events ?? [])
  const [adding, setAdding] = useState("")
  const [newProject, setNewProject] = useState("")
  const [newDue, setNewDue] = useState(date)
  const [newPriority, setNewPriority] = useState<Priority>("medium")
  useEffect(() => setNewDue(date), [date])
  const [showUpcoming, setShowUpcoming] = useState(false)
  useEffect(() => {
    let alive = true
    const hit = calendarCache.get(date)
    setEvents(hit?.events ?? [])
    if (hit && Date.now() - hit.at < 2 * 60_000) return
    tilo
      .request<{ events: CalEvent[] }>("GET", `/calendar?date=${date}`)
      .then((r) => {
        calendarCache.set(date, { at: Date.now(), events: r.events })
        if (alive) setEvents(r.events)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [date])
  const time = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  const tasks = [...view.tasks.dueOrOverdue, ...view.tasks.doneToday]
  return (
    <Card title="Agenda" meta={`${events.length} ${events.length === 1 ? "reunión" : "reuniones"} · ${view.tasks.dueOrOverdue.length} tareas`}>
      {events.map((ev) => (
        <div key={ev.id} className="row">
          <span className="time">{ev.allDay ? "todo el día" : time(ev.start)}</span>
          <span className="t event">{ev.title}</span>
          {ev.meetLink && <a className="d" href={ev.meetLink} target="_blank" rel="noreferrer">Meet</a>}
        </div>
      ))}
      {tasks.map((t) => <TaskRow key={t.id} t={t} date={date} mutate={mutate} projects={day.projects} />)}
      {!tasks.length && !events.length && <div className="empty">Nada para hoy. Agregá tareas con la barra de arriba o acá.</div>}
      <form
        className={adding.trim() ? "edit" : "row"}
        style={adding.trim() ? taskGrid : undefined}
        onSubmit={(e) => {
          e.preventDefault()
          if (!adding.trim()) return
          const input = { title: adding.trim(), due_date: newDue || undefined, priority: newPriority, project: newProject.trim() || undefined }
          setAdding("")
          setNewPriority("medium")
          setNewDue(date)
          void mutate(null, () => tilo.addTask(input), "Tarea agregada")
        }}
      >
        {!adding.trim() && <Plus size={16} color="var(--faint)" aria-hidden="true" />}
        <label htmlFor={`new-task-${date}`} className="sr-only">Nueva tarea</label>
        <input id={`new-task-${date}`} className="input" style={adding.trim() ? undefined : { border: 0, padding: "2px 0", background: "none" }} placeholder="Nueva tarea" value={adding} onChange={(e) => setAdding(e.target.value)} />
        {adding.trim() && (
          <>
            <TaskFields id={`new-${date}`} projects={day.projects} project={newProject} setProject={setNewProject} due={newDue} setDue={setNewDue} priority={newPriority} setPriority={setNewPriority} />
            <button className="btn leaf sm">Agregar</button>
          </>
        )}
      </form>
      {view.tasks.upcoming.length + view.tasks.someday.length > 0 && (
        <>
          <button className="row" style={{ width: "100%", border: 0, background: "none", cursor: "pointer", color: "var(--muted)" }} onClick={() => setShowUpcoming(!showUpcoming)}>
            <span className="t" style={{ textAlign: "left" }}>{showUpcoming ? "Ocultar" : "Ver"} próximas ({view.tasks.upcoming.length + view.tasks.someday.length})</span>
          </button>
          {showUpcoming && [...view.tasks.upcoming, ...view.tasks.someday].map((t) => <TaskRow key={t.id} t={t} date={date} mutate={mutate} projects={day.projects} />)}
        </>
      )}
    </Card>
  )
}

// ---------- Checklist (habits + supplements by time of day) ----------

export function ChecklistCard({ date, view, mutate }: CardProps) {
  const low = view.checklist.flatMap((g) => g.items).filter((i) => i.lowStock)
  return (
    <Card
      title="Hábitos y suplementos"
      meta={`${view.checklistDone}/${view.checklistTotal}`}
      actions={low.length ? <span className="pill warn">stock bajo: {low.map((i) => i.name).join(", ")}</span> : undefined}
    >
      {!view.checklistTotal && <div className="empty">Agregá hábitos y suplementos en Settings y aparecen acá, ordenados por momento del día.</div>}
      {view.checklist.map((g) => (
        <div key={g.slot}>
          <div className="slot">{g.label}</div>
          {g.items.map((i) => (
            <div key={i.id} className={`row${i.done ? " done" : ""}`}>
              <Checkbox
                done={i.done}
                label={`${i.done ? "Desmarcar" : "Marcar"} ${i.name}`}
                onClick={() =>
                  mutate(
                    (d) =>
                      i.kind === "habit"
                        ? { ...d, habits: d.habits.map((h) => (h.id === i.id ? { ...h, done: !i.done } : h)) }
                        : { ...d, supplements: d.supplements.map((s) => (s.id === i.id ? { ...s, taken: !i.done } : s)) },
                    () => (i.kind === "habit" ? tilo.setHabit(i.id, !i.done, date) : tilo.setSupplement(i.id, !i.done, date)),
                  )
                }
              />
              <span className="t">{i.name}</span>
              {i.auto && i.done ? <span className="pill auto">auto</span> : <span className="d">{i.detail}</span>}
              {i.kind === "supplement" && <span className="pill">supl.</span>}
            </div>
          ))}
        </div>
      ))}
    </Card>
  )
}

// ---------- Meals ----------

function MealRow({ m, mutate }: { m: Meal; mutate: Mutate }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState({ description: m.description, kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g })
  if (edit) {
    return (
      <form
        className="edit"
        onSubmit={(e) => {
          e.preventDefault()
          setEdit(false)
          void mutate((d) => ({ ...d, meals: d.meals.map((x) => (x.id === m.id ? { ...x, ...v } : x)) }), () => crud.update("meals", m.id, v), "Comida actualizada")
        }}
      >
        <input className="input" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} aria-label="Descripción" autoFocus />
        {(["kcal", "protein_g", "carbs_g", "fat_g"] as const).map((k) => (
          <input key={k} className="input num" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(",", ".")) || 0 })} aria-label={{ kcal: "kcal", protein_g: "Proteína g", carbs_g: "Carbos g", fat_g: "Grasas g" }[k]} />
        ))}
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn leaf sm">Listo</button>
          <button type="button" className="iconbtn" aria-label="Borrar comida" onClick={() => mutate((d) => ({ ...d, meals: d.meals.filter((x) => x.id !== m.id) }), () => crud.remove("meals", m.id), "Comida borrada")}>
            <Trash2 />
          </button>
        </div>
      </form>
    )
  }
  const assumptions = (m.micros as { _assumptions?: string } | null)?._assumptions
  return (
    <div className="row" title={assumptions ? `Supuestos: ${assumptions}` : undefined}>
      <span className="time">{m.eaten_at?.slice(0, 5) ?? ""}</span>
      <button className="t" onClick={() => setEdit(true)}>{m.description}</button>
      <span className="macro">
        <span>{fmt(Number(m.kcal))}</span>
        <span className="p">P{Math.round(Number(m.protein_g))}</span>
        <span className="c">C{Math.round(Number(m.carbs_g))}</span>
        <span className="f">G{Math.round(Number(m.fat_g))}</span>
      </span>
      <span className="actions"><button className="iconbtn" aria-label={`Editar ${m.description}`} onClick={() => setEdit(true)}><Pencil /></button></span>
    </div>
  )
}

export function MealsCard({ day, view, mutate }: CardProps) {
  const n = view.nutrition
  const pct = (v: number, t: number) => `${Math.round((v / t) * 100)}%`
  return (
    <Card title="Comidas" meta={<span className="mono">{fmt(n.kcal)}/{fmt(n.targets.kcal)} kcal · P{n.protein} C{n.carbs} G{n.fat}</span>}>
      {day.meals.map((m) => <MealRow key={m.id} m={m} mutate={mutate} />)}
      {!day.meals.length && <div className="empty">Escribí lo que comiste en la barra de arriba: “milanesa con puré”, “2 medialunas y un cortado”.</div>}
      {day.meals.length > 0 && (
        <div className="legend" style={{ paddingTop: 6 }}>
          <span><i className="m-p" />Proteína <b>{pct(n.protein, n.targets.protein)}</b></span>
          <span><i className="m-c" />Carbos <b>{pct(n.carbs, n.targets.carbs)}</b></span>
          <span><i className="m-f" />Grasas <b>{pct(n.fat, n.targets.fat)}</b></span>
          <span>Fibra <b>{n.fiber}/{n.targets.fiber} g</b></span>
          {view.caffeine.mg > 0 && <span>Cafeína <b>{view.caffeine.mg} mg</b></span>}
        </div>
      )}
    </Card>
  )
}

// ---------- Training ----------

export function TrainingCard({ date, day, view, mutate }: CardProps) {
  const router = useRouter()
  const t = view.training
  const open = day.workouts.find((w) => !w.ended_at)
  const start = async () => {
    const w = open ?? (await mutate(null, () => tilo.startWorkout({ routine_id: day.routine?.id, name: day.routine?.name, date })))
    router.push(`/workout/${w.id}?date=${date}`)
  }
  return (
    <Card
      title={t.routineName ? `Entrenamiento · ${t.routineName}` : "Entrenamiento"}
      meta={t.items.length ? `${t.items.length} ejercicios` : undefined}
      actions={<button className="btn leaf sm" onClick={start}>{open ? "Continuar" : "Empezar"}</button>}
    >
      {t.items.map((x) => (
        <div key={x.id} className="ex">
          <span>{x.name}</span>
          <span className="last">{x.last ?? "primera vez"}</span>
          <span className="tgt">{x.target}</span>
          {x.suggestion && <span className="sug">{x.suggestion}{x.suggestedKg ? ` → ${x.suggestedKg} kg` : ""}</span>}
        </div>
      ))}
      {day.workouts.filter((w) => w.ended_at).map((w) => (
        <div key={w.id} className="row">
          <span className="t">{w.name} · {w.sets.filter((s) => !s.is_warmup).length} series</span>
          <span className="d mono">{fmt(w.sets.reduce((s, x) => s + Number(x.weight_kg ?? 0) * (x.reps ?? 0), 0))} kg</span>
          <button className="btn ghost sm" onClick={() => router.push(`/workout/${w.id}?date=${date}`)}>Ver</button>
        </div>
      ))}
      {t.activities.map((a) => (
        <div key={a.id} className="row">
          <span className="t">
            {a.name ?? a.type} · {Math.round(a.duration_s / 60)} min{a.distance_m ? ` · ${(Number(a.distance_m) / 1000).toFixed(1)} km` : ""}{a.kcal ? ` · ${fmt(Number(a.kcal))} kcal` : ""}{a.avg_hr ? ` · FC ${a.avg_hr}` : ""}
          </span>
          <span className="pill auto">{{ strava: "Strava", apple: "Apple", google_health: "Google", health_connect: "Android", garmin: "Garmin", manual: "manual" }[a.source]}</span>
        </div>
      ))}
      {!t.items.length && !t.activities.length && !day.workouts.length && (
        <div className="empty">Sin rutina para hoy. Creá rutinas en Settings → Rutinas, o registrá “banca 80x8x3” en la barra.</div>
      )}
      {t.electrolytes && (
        <div className="reco">
          <Lightbulb aria-hidden="true" />
          <span>{t.electrolytes.reason}. Reponé ~<b>{fmt(t.electrolytes.sodiumMg)} mg de sodio</b> y {fmt(t.electrolytes.waterMl)} ml de agua.</span>
        </div>
      )}
    </Card>
  )
}

// ---------- Energy ----------

const SOURCE_LABEL: Record<string, string> = { apple: "Apple Health", google_health: "Google Health", health_connect: "Health Connect", strava: "Strava", garmin: "Garmin", manual: "manual" }

export function EnergyCard({ view }: CardProps) {
  const e = view.energy
  const parts = [
    { cls: "e-bmr", v: e.bmr.kcal, label: "Basal", how: e.bmr.method },
    { cls: "e-neat", v: e.neat.kcal, label: "Movimiento", how: e.neat.method },
    { cls: "e-ex", v: e.exercise.kcal, label: "Ejercicio", how: e.exercise.method },
    { cls: "e-tef", v: e.tef.kcal, label: "Digestión", how: e.tef.method },
  ]
  const total = parts.reduce((s, p) => s + p.v, 0) || 1
  const conf = { high: ["leaf", "confianza alta"], medium: ["warn", "confianza media"], low: ["red", "confianza baja"] }[e.confidence]
  return (
    <Card title="Energía" meta={<span className="mono">{fmt(e.total)} kcal gastadas</span>} actions={<span className={`pill ${conf[0]}`}>{conf[1]}</span>}>
      <div className="energy-bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.v} kcal`).join(", ")}>
        {parts.map((p) => <i key={p.cls} className={p.cls} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.label}: ${p.how}`}>{p.v / total > 0.12 ? fmt(p.v) : ""}</i>)}
      </div>
      <div className="legend">
        {parts.map((p) => <span key={p.cls} title={p.how}><i className={p.cls} />{p.label} <b>{fmt(p.v)}</b></span>)}
      </div>
      <div className="src">
        <span className="chip">{e.bmr.method}</span>
        <span className="chip">{e.neat.method}</span>
        {e.exercise.sessions.map((s) => <span key={s.id} className="chip">{s.kcal} kcal · {s.method}</span>)}
        {e.calibration !== 1 && <span className="chip">calibrado {e.calibration > 1 ? "+" : ""}{Math.round((e.calibration - 1) * 100)}% con tu peso real</span>}
        {Object.entries(view.metrics.sources).filter(([k]) => k === "steps" || k === "active_kcal").map(([k, s]) => (
          <span key={k} className="chip">{k === "steps" ? "pasos" : "energía activa"}: {SOURCE_LABEL[s!] ?? s}</span>
        ))}
      </div>
      {e.confidence === "low" && (() => {
        const movement = view.metrics.values.steps != null || view.metrics.values.active_kcal != null
        const meals = day.meals.length > 0
        const text = !movement && !meals
          ? "Sin datos de movimiento ni comidas el cálculo es aproximado. Conectá tu reloj o celular y registrá lo que comés para que sea exacto."
          : !meals
            ? "Tu movimiento ya llega. Registrá lo que comés (arriba, o con una foto o texto) para que el balance sea exacto."
            : "Sin datos de movimiento el gasto es una estimación. Conectá tu reloj o celular en Settings → Conexiones."
        return <div className="reco warn"><Lightbulb aria-hidden="true" /><span>{text}</span></div>
      })()}
    </Card>
  )
}

// ---------- Mail ----------

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 160
  const h = 40
  const max = Math.max(...values)
  const min = Math.min(...values) - 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / (max - min || 1)) * (h - 10)])
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
  const last = pts[pts.length - 1]
  const grew = values[values.length - 1] > values[0]
  const color = grew ? "var(--danger)" : "var(--leaf)"
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Bandeja de entrada, últimos días">
      <path d={`${d} L${last[0]} ${h} L3 ${h} Z`} fill={`color-mix(in srgb, ${color} 12%, transparent)`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  )
}

export function MailCard({ date, day, view, mutate }: CardProps) {
  const m = view.email
  const senders = new Map<string, { sender: string; count: number; unopened: number; unsubscribe?: string }>()
  for (const s of day.email.snapshots) {
    for (const t of s.top_senders ?? []) {
      const e = senders.get(t.sender) ?? { ...t, count: 0, unopened: 0 }
      e.count += t.count
      e.unopened += t.unopened
      senders.set(t.sender, e)
    }
  }
  const noisy = [...senders.values()].filter((s) => s.unopened >= 3).sort((a, b) => b.unopened - a.unopened).slice(0, 5)
  const trend = m.trend.map((t) => t.inbox)
  const grew3 = trend.length >= 4 && trend.slice(-4).every((v, i, a) => i === 0 || v > a[i - 1])
  if (m.inboxTotal == null) {
    return (
      <Card title="Mail">
        <div className="empty">
          Conectá Gmail para ver cuántos mails personales vs. newsletters recibís, cómo crece tu bandeja y cuáles esperan respuesta.{" "}
          <a href="/api/connect/google?features=gmail,calendar&return=/">Conectar Gmail y Calendar</a>
        </div>
      </Card>
    )
  }
  return (
    <Card title="Mail" meta={`bandeja ${fmt(m.inboxTotal)}${trend.length > 1 ? ` (${trend.at(-1)! - trend[0] >= 0 ? "+" : ""}${trend.at(-1)! - trend[0]} en ${trend.length} días)` : ""}`}>
      <div className="inbox-top">
        <div><div className="v">{m.unread}</div><div className="l">no leídos</div></div>
        <div><div className="v">{m.personal}</div><div className="l">personales hoy</div></div>
        <div><div className="v">{m.newsletters}</div><div className="l">newsletters hoy</div></div>
        <div><Sparkline values={trend} /></div>
      </div>
      {m.insights.map((i) => (
        <div key={i.id} className="row">
          <Mail size={15} color="var(--faint)" aria-hidden="true" />
          <span className="t"><b>{i.from_name}</b> · {i.subject}</span>
          <span className={`pill ${i.category === "deadline" ? "red" : i.category === "reply" ? "leaf" : ""}`}>
            {i.category === "reply" ? "espera respuesta" : i.category === "deadline" ? `fecha${i.due_date ? ` ${i.due_date.slice(5).split("-").reverse().join("/")}` : ""}` : "info"}
          </span>
          <button
            className="btn ghost sm"
            onClick={() =>
              mutate(
                (d) => ({ ...d, email: { ...d.email, insights: d.email.insights.filter((x) => x.id !== i.id) } }),
                async () => {
                  const t = await tilo.addTask({
                    title: i.category === "reply" ? `Responder a ${i.from_name}: ${i.subject}` : i.subject ?? "Mail",
                    due_date: i.due_date ?? date, source: "email", source_ref: { message_id: i.message_id, account: i.account_email },
                  })
                  await crud.update("email_insights", i.id, { task_id: t.id })
                },
                "Tarea creada",
              )
            }
          >
            → tarea
          </button>
          <button className="iconbtn" aria-label="Descartar" onClick={() => mutate((d) => ({ ...d, email: { ...d.email, insights: d.email.insights.filter((x) => x.id !== i.id) } }), () => crud.update("email_insights", i.id, { dismissed: true }))}>
            <X />
          </button>
        </div>
      ))}
      {noisy.length > 0 && (
        <div className="reco">
          <Lightbulb aria-hidden="true" />
          <span>
            {noisy.length} remitentes te mandaron {noisy.reduce((s, n) => s + n.unopened, 0)} newsletters sin abrir esta semana:{" "}
            {noisy.map((n, idx) => (
              <span key={n.sender}>
                {idx > 0 && ", "}
                {n.unsubscribe ? <a href={n.unsubscribe} target="_blank" rel="noreferrer">{n.sender}</a> : n.sender}
              </span>
            ))}
            . Desuscribite con un click.
          </span>
        </div>
      )}
      {grew3 && (
        <div className="reco warn"><Lightbulb aria-hidden="true" /><span>Tu bandeja creció 3 días seguidos. Bloqueá 20 minutos mañana para dejarla en cero.</span></div>
      )}
    </Card>
  )
}
