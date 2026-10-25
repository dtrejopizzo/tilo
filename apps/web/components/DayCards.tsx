"use client"

import { MEAL_TYPES, type DayData, type Meal, type Task } from "@tilo/core/apiTypes"
import type { TodayView } from "@tilo/core/today"
import { Check, EyeOff, Lightbulb, Mail, Pencil, Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { crud, fmt, litres, localDate, tilo } from "@/lib/client/api"
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

interface CalEvent { id: string; title: string; start: string; end: string; allDay: boolean; meetLink: string | null; account?: string }

type Priority = Task["priority"]

// Project (pick one, or "Nuevo proyecto…" to type a name that is created and kept), deadline and priority
const NEW_PROJECT = "__new__"
function TaskFields({ id, projects, project, setProject, due, setDue, priority, setPriority }: {
  id: string; projects: DayData["projects"]; project: string; setProject: (v: string) => void
  due: string; setDue: (v: string) => void; priority: Priority; setPriority: (v: Priority) => void
}) {
  const known = projects.some((p) => p.name === project)
  const [creating, setCreating] = useState(!!project && !known)
  return (
    <>
      {creating ? (
        <input className="input" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Nombre del proyecto" aria-label="Nuevo proyecto" autoFocus
          onBlur={() => { if (!project.trim()) setCreating(false) }} />
      ) : (
        <select className="input" value={known ? project : ""} aria-label="Proyecto"
          onChange={(e) => { if (e.target.value === NEW_PROJECT) { setProject(""); setCreating(true) } else setProject(e.target.value) }}>
          <option value="">Sin proyecto</option>
          {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          <option value={NEW_PROJECT}>＋ Nuevo proyecto…</option>
        </select>
      )}
      <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha límite" />
      <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label="Prioridad">
        <option value="high">Alta</option>
        <option value="medium">Media</option>
        <option value="low">Baja</option>
      </select>
    </>
  )
}

// Titles can carry a link (a form, a job post, a startup program): show it clickable, in a new tab
const URL_RE = /(https?:\/\/[^\s<>"']+)/g
function TaskTitle({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        URL_RE.test(part) && (URL_RE.lastIndex = 0) === 0 && /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="link" onClick={(e) => e.stopPropagation()} title={part}>
            {part.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 48)}{part.replace(/^https?:\/\/(www\.)?/, "").length > 48 ? "…" : ""}
          </a>
        ) : (
          part
        ),
      )}
    </>
  )
}

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
        className="task-edit"
        onSubmit={(e) => {
          e.preventDefault()
          setEditing(false)
          void mutate(
            (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, title, due_date: due || null, priority } : x)) }),
            () => tilo.updateTask(t.id, { title, due_date: due || null, priority, project: projectName.trim() || null }, date),
          )
        }}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
      >
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título" autoFocus placeholder="Título (puede incluir un link)" />
        <div className="task-edit-row">
          <TaskFields id={t.id} projects={projects} project={projectName} setProject={setProjectName} due={due} setDue={setDue} priority={priority} setPriority={setPriority} />
          <span className="spacer" />
          <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Cancelar</button>
          <button className="btn leaf sm">Guardar</button>
          <button
            type="button"
            className="iconbtn"
            aria-label="Borrar tarea"
            title="Borrar tarea"
            onClick={() => mutate((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }), () => tilo.request("DELETE", `/tasks/${t.id}`), "Tarea borrada")}
          >
            <Trash2 />
          </button>
        </div>
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
      <span className="t" role="button" tabIndex={0} title="Click para editar" onClick={() => setEditing(true)} onKeyDown={(e) => e.key === "Enter" && setEditing(true)}><TaskTitle text={t.title} /></span>
      {t.priority === "high" && !done && <span className="pill red">alta</span>}
      {t.priority === "low" && !done && <span className="d">baja</span>}
      {project && <span className="d">{project.name}</span>}
      {overdue ? <span className="pill red">vencida · {ddmm(t.due_date!)}</span> : t.due_date && t.due_date !== date && !done && <span className="d">{ddmm(t.due_date)}</span>}
      {t.source === "code" && <span className="pill auto">código</span>}
      {t.source === "email" && <span className="pill auto" title={(t.source_ref as { account?: string } | null)?.account ?? "mail"}>mail{accountLabel((t.source_ref as { account?: string } | null)?.account)}</span>}
    </div>
  )
}

// "· nombre" when the person has more than one Google account connected, so each item says where it came from
let accountCount = 1
const accountLabel = (email?: string | null) => (accountCount > 1 && email ? ` · ${email.split("@")[0]}` : "")

const calendarCache = new Map<string, { at: number; events: CalEvent[] }>()

function useCalendar(date: string) {
  const [events, setEvents] = useState<CalEvent[]>(() => calendarCache.get(date)?.events ?? [])
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
  return events
}

const normTitle = (t: string) => t.trim().toLowerCase()

// "dt@carbo.energy" → "carbo", "dtrejopizzo@gmail.com" → "gmail": which calendar an event came from
const calendarLabel = (email?: string) => (email ? (email.split("@")[1] ?? email).split(".")[0] : "")
const CAL_COLORS = ["var(--carbs)", "var(--protein)", "var(--fat)", "var(--leaf)", "#1fa6b8", "#d6457f"]

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const left = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`
}

// Today's calendar from every connected Google account. Finished events drop off; the one in
// progress shows how much is left. Recurring blocks (sleep, training) can be hidden by title.
export function AgendaCard({ date, day, mutate }: CardProps) {
  const events = useCalendar(date)
  const now = useNow()
  const hidden: string[] = ((day.settings as { hidden_events?: string[] } | null)?.hidden_events ?? []).map(normTitle)
  const [showHidden, setShowHidden] = useState(false)
  const time = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  const accounts = [...new Set(events.map((e) => e.account).filter(Boolean))] as string[]
  const color = (a?: string) => CAL_COLORS[Math.max(0, accounts.indexOf(a ?? "")) % CAL_COLORS.length]
  const setHidden = (next: string[]) =>
    mutate(
      (d) => ({ ...d, settings: { ...(d.settings ?? {}), hidden_events: next } }),
      () => tilo.request("PATCH", "/settings", { settings: { hidden_events: next } }),
    )
  const isToday = date === localDate()
  const shown = events.filter((e) => !hidden.includes(normTitle(e.title)))
  // On today, past timed events disappear; other days show everything
  const visible = shown.filter((e) => !isToday || e.allDay || Date.parse(e.end) > now)
  const current = isToday ? visible.find((e) => !e.allDay && Date.parse(e.start) <= now && Date.parse(e.end) > now) : undefined
  const next = isToday ? visible.find((e) => !e.allDay && Date.parse(e.start) > now) : undefined
  const meta = current ? (
    <span className="now"><i className="pulse" />{current.title.slice(0, 28)} · quedan {left(Date.parse(current.end) - now)}</span>
  ) : next ? (
    `próxima en ${left(Date.parse(next.start) - now)}`
  ) : (
    `${visible.length} ${visible.length === 1 ? "evento" : "eventos"}`
  )
  return (
    <Card title="Agenda" meta={meta}>
      {visible.map((ev) => {
        const live = ev === current
        const remaining = live ? (Date.parse(ev.end) - now) / (Date.parse(ev.end) - Date.parse(ev.start)) : 0
        return (
          <div key={ev.id} className={`row ag${live ? " live" : ""}`}>
            <span className="time">{ev.allDay ? "día" : time(ev.start)}</span>
            <span className="t event wrap" style={{ borderLeftColor: color(ev.account) }}>{ev.title}</span>
            {accounts.length > 1 && ev.account && <span className="d" style={{ color: color(ev.account) }}>{calendarLabel(ev.account)}</span>}
            {ev.meetLink && <a className="d" href={ev.meetLink} target="_blank" rel="noreferrer">Meet</a>}
            <span className="actions">
              <button className="iconbtn" title={`Ocultar "${ev.title}" siempre`} aria-label={`Ocultar ${ev.title} siempre`} onClick={() => setHidden([...new Set([...hidden, normTitle(ev.title)])])}><EyeOff /></button>
            </span>
            {live && <i className="ag-left" style={{ width: `${Math.max(0, Math.min(1, remaining)) * 100}%`, background: color(ev.account) }} />}
          </div>
        )
      })}
      {!visible.length && <div className="empty">{shown.length ? "Terminaste la agenda de hoy." : "Sin reuniones hoy."}</div>}
      {hidden.length > 0 && (
        <>
          <button className="row" style={{ width: "100%", border: 0, background: "none", cursor: "pointer", color: "var(--muted)" }} onClick={() => setShowHidden(!showHidden)}>
            <span className="t" style={{ textAlign: "left", fontSize: 12 }}>{hidden.length} {hidden.length === 1 ? "evento oculto" : "eventos ocultos"} {showHidden ? "▾" : "▸"}</span>
          </button>
          {showHidden && hidden.map((h) => (
            <div key={h} className="row" style={{ paddingLeft: 16 }}>
              <span className="t d" style={{ textTransform: "capitalize" }}>{h}</span>
              <button className="btn ghost sm" onClick={() => setHidden(hidden.filter((x) => x !== h))}>Mostrar</button>
            </div>
          ))}
        </>
      )}
    </Card>
  )
}

// Tasks due today (and done today), with the new-task form: title, project, deadline, priority
export function TasksCard({ date, day, view, mutate }: CardProps) {
  const [adding, setAdding] = useState("")
  const [newProject, setNewProject] = useState("")
  const [newDue, setNewDue] = useState(date)
  const [newPriority, setNewPriority] = useState<Priority>("medium")
  useEffect(() => setNewDue(date), [date])
  accountCount = new Set(day.tasks.map((t) => (t.source_ref as { account?: string } | null)?.account).filter(Boolean)).size
  const fromMail = view.tasks.dueOrOverdue.filter((t) => t.source === "email").length
  const overdue = view.tasks.dueOrOverdue.filter((t) => t.due_date && t.due_date < date)
  const todays = view.tasks.dueOrOverdue.filter((t) => !t.due_date || t.due_date >= date)
  const group = (label: string, list: Task[]) =>
    list.length > 0 && (
      <>
        <div className="slot">{label} · {list.length}</div>
        {list.map((t) => <TaskRow key={t.id} t={t} date={date} mutate={mutate} projects={day.projects} />)}
      </>
    )
  const total = view.tasks.dueOrOverdue.length + view.tasks.upcoming.length + view.tasks.someday.length
  return (
    <Card title="Tareas" meta={`${total} pendientes${fromMail ? ` · ${fromMail} de mails` : ""} · ${view.tasks.doneToday.length} hechas hoy`}>
      <form
        className={adding.trim() ? "task-edit" : "row"}
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
        <input id={`new-task-${date}`} className="input" style={adding.trim() ? undefined : { border: 0, padding: "2px 0", background: "none" }} placeholder="Nueva tarea (texto o un link)" value={adding} onChange={(e) => setAdding(e.target.value)} />
        {adding.trim() && (
          <div className="task-edit-row">
            <TaskFields id={`new-${date}`} projects={day.projects} project={newProject} setProject={setNewProject} due={newDue} setDue={setNewDue} priority={newPriority} setPriority={setNewPriority} />
            <span className="spacer" />
            <button type="button" className="btn ghost sm" onClick={() => setAdding("")}>Cancelar</button>
            <button className="btn leaf sm">Agregar</button>
          </div>
        )}
      </form>
      {group("Vencidas", overdue)}
      {group("Hoy", todays)}
      {!overdue.length && !todays.length && <div className="empty">Nada pendiente para hoy.</div>}
      {group("Próximas", view.tasks.upcoming)}
      {group("Sin fecha", view.tasks.someday)}
      {group("Hechas hoy", view.tasks.doneToday)}
    </Card>
  )
}

// ---------- Checklist (habits + supplements by time of day) ----------

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"] // 0 = Monday … 6 = Sunday

// Name, days of the week and daily/weekly; the same fields as Settings, right in the card
function HabitForm({ initial, onSave, onCancel, onArchive }: {
  initial: { name: string; days: number[] }
  onSave: (v: { name: string; days: number[]; frequency: "daily" | "weekly"; per_week: number }) => void
  onCancel: () => void
  onArchive?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [days, setDays] = useState<number[]>(initial.days)
  return (
    <form
      className="task-edit"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !days.length) return
        onSave({ name: name.trim(), days: [...days].sort(), frequency: days.length === 7 ? "daily" : "weekly", per_week: days.length })
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hábito (leer 20 min, meditar…)" aria-label="Nombre del hábito" autoFocus />
      <div className="task-edit-row">
        <span className="days" role="group" aria-label="Días">
          {WEEKDAYS.map((d, i) => (
            <button key={i} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>{d}</button>
          ))}
        </span>
        <button type="button" className="btn ghost sm" onClick={() => setDays(days.length === 7 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6])}>{days.length === 7 ? "Lun a vie" : "Todos"}</button>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancelar</button>
        <button className="btn leaf sm" disabled={!name.trim() || !days.length}>Guardar</button>
        {onArchive && <button type="button" className="iconbtn" title="Archivar hábito" aria-label="Archivar hábito" onClick={onArchive}><Trash2 /></button>}
      </div>
    </form>
  )
}

export function ChecklistCard({ date, day, view, mutate }: CardProps) {
  const low = view.checklist.flatMap((g) => g.items).filter((i) => i.lowStock)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <Card
      title="Hábitos y suplementos"
      meta={`${view.checklistDone}/${view.checklistTotal}`}
      actions={
        <>
          {low.length > 0 && <span className="pill warn" title={`Stock bajo: ${low.map((i) => i.name).join(", ")}`}>stock bajo · {low.length}</span>}
          <button className="iconbtn" title="Nuevo hábito" aria-label="Nuevo hábito" onClick={() => setAdding(true)}><Plus /></button>
        </>
      }
    >
      {adding && (
        <HabitForm
          initial={{ name: "", days: [0, 1, 2, 3, 4, 5, 6] }}
          onCancel={() => setAdding(false)}
          onSave={(v) => {
            setAdding(false)
            void mutate(null, () => crud.create("habits", { ...v, position: day.habits.length }), "Hábito agregado")
          }}
        />
      )}
      {!view.checklistTotal && <div className="empty">Agregá hábitos y suplementos en Settings y aparecen acá, ordenados por momento del día.</div>}
      {view.checklist.map((g) => (
        <div key={g.slot}>
          <div className="slot">{g.label}</div>
          {g.items.map((i) => {
            const habit = i.kind === "habit" ? day.habits.find((h) => h.id === i.id) : undefined
            if (habit && editing === habit.id) {
              return (
                <HabitForm
                  key={i.id}
                  initial={{ name: habit.name, days: (habit as { days?: number[] }).days ?? [0, 1, 2, 3, 4, 5, 6] }}
                  onCancel={() => setEditing(null)}
                  onSave={(v) => {
                    setEditing(null)
                    void mutate((d) => ({ ...d, habits: d.habits.map((h) => (h.id === habit.id ? { ...h, name: v.name } : h)) }), () => crud.update("habits", habit.id, v), "Hábito actualizado")
                  }}
                  onArchive={() => {
                    setEditing(null)
                    void mutate((d) => ({ ...d, habits: d.habits.filter((h) => h.id !== habit.id) }), () => crud.update("habits", habit.id, { archived: true }), "Hábito archivado")
                  }}
                />
              )
            }
            return (
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
              {habit ? (
                <span className="t" role="button" tabIndex={0} title="Click para editar" style={{ cursor: "pointer" }} onClick={() => setEditing(habit.id)} onKeyDown={(e) => e.key === "Enter" && setEditing(habit.id)}>{i.name}</span>
              ) : (
                <span className="t">{i.name}</span>
              )}
              {i.auto && i.done ? <span className="pill auto">auto</span> : <span className="d">{i.detail}</span>}
              {i.kind === "supplement" && <span className="pill">supl.</span>}
            </div>
            )
          })}
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
  const r = (v: unknown) => Math.round(Number(v ?? 0))
  return (
    <div className="meal-row" title={assumptions ? `Supuestos: ${assumptions}` : undefined} onClick={() => setEdit(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setEdit(true)}>
      <span className="mt">{MEAL_LABEL[m.meal_type ?? ""] ?? "Comida"}</span>
      <span className="md">{m.description}</span>
      <span className="mn">{fmt(Number(m.kcal))}</span>
      <span className="mn p">{r(m.protein_g)}</span>
      <span className="mn c">{r(m.carbs_g)}</span>
      <span className="mn f">{r(m.fat_g)}</span>
      <span className="mn">{r(m.fiber_g)}</span>
    </div>
  )
}

const MEAL_LABEL: Record<string, string> = Object.fromEntries(MEAL_TYPES.map((t) => [t.type, t.label]))
const MEAL_ORDER: Record<string, number> = Object.fromEntries(MEAL_TYPES.map((t, i) => [t.type, i]))

export function MealsCard({ day, view, mutate }: CardProps) {
  const n = view.nutrition
  const pct = (v: number, t: number) => `${Math.round((v / t) * 100)}%`
  return (
    <Card title="Comidas" meta={`${day.meals.length} ${day.meals.length === 1 ? "registro" : "registros"}`}>
      {day.meals.length > 0 && (
        <div className="meal-row head">
          <span className="mt" /><span className="md" />
          <span className="mn">kcal</span><span className="mn p">prot</span><span className="mn c">carb</span><span className="mn f">grasa</span><span className="mn">fibra</span>
        </div>
      )}
      {[...day.meals]
        .sort((a, b) => (MEAL_ORDER[a.meal_type ?? "snack"] ?? 9) - (MEAL_ORDER[b.meal_type ?? "snack"] ?? 9) || (a.eaten_at ?? "").localeCompare(b.eaten_at ?? ""))
        .map((m) => <MealRow key={m.id} m={m} mutate={mutate} />)}
      {day.meals.length > 0 && (
        <div className="meal-row total">
          <span className="mt">Total</span>
          <span className="md">objetivo {fmt(n.targets.kcal)} kcal · {n.targets.protein} g prot</span>
          <span className="mn">{fmt(n.kcal)}</span><span className="mn p">{n.protein}</span><span className="mn c">{n.carbs}</span><span className="mn f">{n.fat}</span><span className="mn">{n.fiber}</span>
        </div>
      )}
      {!day.meals.length && <div className="empty">Escribí lo que comiste en la barra de arriba: “almuerzo: 2 empanadas”, “merienda: café con leche y 2 medialunas”.</div>}
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

// ---------- Weekly reading (AI), shown inside the Energy card ----------

interface Progress {
  goals: { key: string; label: string; value: string; target: string; ratio: number | null; trend: "up" | "down" | "flat" | null; good: boolean | null; note?: string }[]
  bullets: string[]
  aiError: string | null
}
const progressCache = new Map<string, { at: number; p: Progress }>()

function useInsights(date: string) {
  const [p, setP] = useState<Progress | null>(() => progressCache.get(date)?.p ?? null)
  useEffect(() => {
    let alive = true
    const hit = progressCache.get(date)
    if (hit && Date.now() - hit.at < 5 * 60_000) return void setP(hit.p)
    tilo.request<Progress>("GET", `/insights?date=${date}`).then((r) => {
      progressCache.set(date, { at: Date.now(), p: r })
      if (alive) setP(r)
    }).catch((e) => alive && setP({ goals: [], bullets: [], aiError: e instanceof Error ? e.message : "No pude leer tu semana." }))
    return () => {
      alive = false
    }
  }, [date])
  return p
}

const ACT_LABEL: Record<string, string> = {
  run: "Correr", walk: "Caminar", hike: "Trekking", ride: "Bici", swim: "Natación", strength: "Fuerza", hiit: "HIIT", other: "Entrenamiento",
  yoga: "Yoga", mobility: "Movilidad", tennis: "Tenis", padel: "Pádel", football: "Fútbol", golf: "Golf", rowing: "Remo", climbing: "Escalada",
  boxing: "Box", dance: "Baile", surf: "Surf", ski: "Ski", elliptical: "Elíptico",
}

// Tiny marks so you can tell at a glance where a session came from
function SourceLogo({ source }: { source: string }) {
  const box = { width: 14, height: 14, flex: "none" as const }
  if (source === "strava") return <svg viewBox="0 0 24 24" style={box} aria-label="Strava"><path fill="#fc4c02" d="M15.39 17.94l-2.09-4.12h-3.06L15.39 24l5.15-10.18h-3.07M10.46 0l-7 13.83h4.17l2.83-5.6 2.84 5.6h4.17z" /></svg>
  if (source === "apple") return <svg viewBox="0 0 24 24" style={box} aria-label="Apple Health"><path fill="#ff2d55" d="M12 21.6l-1.45-1.32C5.4 15.6 2 12.5 2 8.7 2 5.6 4.4 3.2 7.5 3.2c1.74 0 3.41.81 4.5 2.09A6 6 0 0116.5 3.2C19.6 3.2 22 5.6 22 8.7c0 3.8-3.4 6.9-8.55 11.58z" /></svg>
  if (source === "google_health" || source === "health_connect") return <svg viewBox="0 0 24 24" style={box} aria-label="Google Health"><path fill="#4285f4" d="M12 21.6l-1.45-1.32C5.4 15.6 2 12.5 2 8.7 2 5.6 4.4 3.2 7.5 3.2c1.74 0 3.41.81 4.5 2.09V21.6z" /><path fill="#34a853" d="M12 21.6V5.29A6 6 0 0116.5 3.2C19.6 3.2 22 5.6 22 8.7c0 3.8-3.4 6.9-8.55 11.58z" /></svg>
  if (source === "garmin") return <svg viewBox="0 0 24 24" style={box} aria-label="Garmin"><path fill="#007cc3" d="M12 2L2 21h20z" /></svg>
  return <svg viewBox="0 0 24 24" style={box} aria-label={source}><circle cx="12" cy="12" r="8" fill="var(--faint)" /></svg>
}

export function EnergyCard({ view, day, date }: CardProps) {
  const e = view.energy
  const insights = useInsights(date)
  const parts = [
    { cls: "e-bmr", v: e.bmr.kcal, label: "Basal", how: e.bmr.method },
    { cls: "e-neat", v: e.neat.kcal, label: "Movimiento", how: e.neat.method },
    { cls: "e-ex", v: e.exercise.kcal, label: "Ejercicio", how: e.exercise.method },
    { cls: "e-tef", v: e.tef.kcal, label: "Digestión", how: e.tef.method },
  ]
  const total = parts.reduce((s, p) => s + p.v, 0) || 1
  const how = e.confidence === "high" ? ["leaf", "medido por tu reloj"] : e.confidence === "medium" ? ["", "calculado con tus pasos"] : null
  const kcalOf = new Map(e.exercise.sessions.map((x) => [x.id, x.kcal]))
  return (
    <Card title="Energía" meta={<span className="mono">{fmt(e.total)} kcal gastadas</span>} actions={how ? <span className={`pill ${how[0]}`}>{how[1]}</span> : undefined}>
      <div className="energy-bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.v} kcal`).join(", ")}>
        {parts.map((p) => <i key={p.cls} className={p.cls} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.label}: ${p.how}`}>{p.v / total > 0.12 ? fmt(p.v) : ""}</i>)}
      </div>
      <div className="legend">
        {parts.map((p) => <span key={p.cls} title={p.how}><i className={p.cls} />{p.label} <b>{fmt(p.v)}</b></span>)}
      </div>
      {day.activities.length > 0 && (
        <div className="acts">
          {day.activities.map((a) => (
            <div key={a.id} className="act" title={`${SOURCE_LABEL[a.source] ?? a.source}${a.device ? ` · ${a.device}` : ""}`}>
              <SourceLogo source={a.source} />
              <span className="an">{a.name || ACT_LABEL[a.type] || a.type}</span>
              <span className="ad">{new Date(a.start_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
              <span className="ad">{Math.round(a.duration_s / 60)} min</span>
              <span className="ad">{a.distance_m ? `${(Number(a.distance_m) / 1000).toFixed(1)} km` : ""}</span>
              <span className="ak">{kcalOf.has(a.id) ? `${fmt(kcalOf.get(a.id)!)} kcal` : ""}</span>
            </div>
          ))}
        </div>
      )}
      <div className="src">
        <span className="chip">{e.bmr.method}</span>
        <span className="chip">{e.neat.method}</span>
        {e.calibration !== 1 && <span className="chip">calibrado {e.calibration > 1 ? "+" : ""}{Math.round((e.calibration - 1) * 100)}% con tu peso real</span>}
        {Object.entries(view.metrics.sources).filter(([k]) => k === "steps" || k === "active_kcal").map(([k, s]) => (
          <span key={k} className="chip">{k === "steps" ? "pasos" : "energía activa"}: {SOURCE_LABEL[s!] ?? s}</span>
        ))}
      </div>
      {e.confidence === "low" && (
        <div className="reco"><Lightbulb aria-hidden="true" /><span>Conectá tu reloj o celular (Settings → Conexiones) y el gasto pasa a medirse con tus pasos y tu energía activa.</span></div>
      )}
      <div className="slot" style={{ paddingLeft: 10 }}>Tu semana</div>
      {insights === null ? (
        <div className="empty" style={{ paddingTop: 2 }}>Analizando tu semana…</div>
      ) : insights.bullets.length > 0 ? (
        <ul className="insights" aria-label="Tu semana">{insights.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
      ) : (
        <div className="empty" style={{ paddingTop: 2 }}>{insights.aiError ?? "Todavía no hay datos suficientes para leer tu semana."}</div>
      )}
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
          <span className="t"><b>{i.from_name}</b> · {i.subject}{new Set(m.insights.map((x) => x.account_email)).size > 1 && <span className="d"> · {i.account_email.split("@")[0]}</span>}</span>
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
