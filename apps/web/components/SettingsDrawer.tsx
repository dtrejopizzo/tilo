"use client"

import type { ApiTokenInfo, Goals, Profile } from "@tilo/core/apiTypes"
import { ageFrom, bmr } from "@tilo/core/energy"
import { SLOT_LABELS, SUPPLEMENT_PRESETS, type SupplementSlot } from "@tilo/core/supplements"
import { Copy, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { crud, fmt, localDate, tilo } from "@/lib/client/api"
import { ToastProvider, useToast } from "@/lib/client/toast"
import { invalidateDay } from "@/lib/client/useDay"
import { Drawer } from "./Drawer"

type Row = Record<string, unknown> & { id: string }

interface Catalog {
  habits: Row[]
  supplements: Row[]
  routines: (Row & { items: Row[] })[]
  projects: Row[]
  exercises: { id: string; user_id: string | null; name: string; name_es: string | null; primary_muscle: string; kind: string }[]
}

const SECTIONS: [string, string][] = [
  ["goals", "Objetivos"], ["habits", "Hábitos"], ["supplements", "Suplementos"], ["routines", "Rutinas"],
  ["projects", "Proyectos"], ["connections", "Conexiones"], ["ai", "IA"], ["developer", "VSCode y MCP"],
]
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"]

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="section" id={`settings-${id}`}>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {children}
    </section>
  )
}

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: number; suffix?: string }) {
  const id = `n-${label.replace(/\W/g, "")}`
  return (
    <label className="field" htmlFor={id}>
      <span>{label}{suffix ? ` (${suffix})` : ""}</span>
      <input id={id} className="input num" type="number" step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </label>
  )
}

function Days({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <span className="days" role="group" aria-label="Días">
      {WEEKDAYS.map((d, i) => (
        <button key={i} type="button" aria-pressed={value.includes(i)} onClick={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())}>{d}</button>
      ))}
    </span>
  )
}

// ---------- goals ----------

function GoalsSection() {
  const { toast } = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [goals, setGoals] = useState<Goals | null>(null)
  const [weight, setWeight] = useState<number | null>(null)
  const [savedWeight, setSavedWeight] = useState<number | null>(null)
  const [freezes, setFreezes] = useState(1)

  useEffect(() => {
    tilo.request<{ profile: Profile; goals: Goals; settings: { streak_freezes?: number } }>("GET", "/settings").then((r) => {
      setProfile(r.profile)
      setGoals(r.goals)
      setFreezes(Number(r.settings.streak_freezes ?? 1))
    })
    tilo.getDay(localDate()).then((d) => {
      const kg = d.weight ? Number(d.weight.kg) : null
      setWeight(kg)
      setSavedWeight(kg)
    }).catch(() => {})
  }, [])
  if (!profile || !goals) return <Section id="goals" title="Objetivos"><p className="hint">Cargando…</p></Section>

  const p = (k: keyof Profile, v: unknown) => setProfile({ ...profile, [k]: v })
  const g = (k: keyof Goals, v: unknown) => setGoals({ ...goals, [k]: v })
  const kg = weight ?? 75
  const base = bmr({ sex: profile.sex, ageYears: ageFrom(profile.birth_date, localDate()), heightCm: profile.height_cm, bodyFatPct: profile.body_fat_pct, activityLevel: Number(profile.activity_level) }, kg)
  const maintenance = base.kcal * Number(profile.activity_level)
  const days = goals.weight_target_date ? Math.max(1, (Date.parse(goals.weight_target_date) - Date.now()) / 86_400_000) : null
  const delta = goals.weight_target_kg != null && days ? ((Number(goals.weight_target_kg) - kg) * 7700) / days : 0
  const suggested = Math.round((maintenance + delta) / 10) * 10
  const pace = goals.weight_target_kg != null && days ? ((Number(goals.weight_target_kg) - kg) / days) * 7 : null
  const macroKcal = goals.protein_g * 4 + goals.carbs_g * 4 + goals.fat_g * 9
  const preset = (pp: number, cc: number, ff: number) =>
    setGoals({ ...goals, protein_g: Math.round((goals.kcal * pp) / 400), carbs_g: Math.round((goals.kcal * cc) / 400), fat_g: Math.round((goals.kcal * ff) / 900) })

  const save = async () => {
    const { id: _i, email: _e, avatar_url: _a, plan: _p, trial_ends_at: _t, ...profilePatch } = profile as Profile & Record<string, unknown>
    void _i; void _e; void _a; void _p; void _t
    const { updated_at: _u, user_id: _uid, ...goalsPatch } = goals as Goals & Record<string, unknown>
    void _u; void _uid
    await tilo.request("PATCH", "/settings", {
      profile: Object.fromEntries(Object.entries(profilePatch).filter(([k]) => ["name", "birth_date", "sex", "height_cm", "body_fat_pct", "activity_level", "timezone"].includes(k))),
      goals: goalsPatch,
      settings: { streak_freezes: freezes },
    })
    if (weight != null && weight !== savedWeight) {
      await tilo.addWeight(weight, undefined, localDate())
      setSavedWeight(weight)
    }
    invalidateDay(localDate())
    toast("Objetivos guardados")
  }

  return (
    <Section id="goals" title="Objetivos" desc="Tu perfil define el metabolismo basal; los objetivos se usan en Today, Stats, VSCode y el MCP.">
      <div className="row-inputs">
        <label className="field" htmlFor="s-name"><span>Nombre</span><input id="s-name" className="input" value={profile.name ?? ""} onChange={(e) => p("name", e.target.value)} /></label>
        <label className="field" htmlFor="s-birth"><span>Nacimiento</span><input id="s-birth" className="input" type="date" value={profile.birth_date ?? ""} onChange={(e) => p("birth_date", e.target.value || null)} /></label>
        <label className="field" htmlFor="s-sex"><span>Sexo</span>
          <select id="s-sex" className="select" value={profile.sex ?? ""} onChange={(e) => p("sex", e.target.value || null)}>
            <option value="">—</option><option value="male">Masculino</option><option value="female">Femenino</option>
          </select>
        </label>
        <Num label="Altura" suffix="cm" value={profile.height_cm} onChange={(v) => p("height_cm", v)} />
        <Num label="Grasa corporal" suffix="%" value={profile.body_fat_pct} step={0.1} onChange={(v) => p("body_fat_pct", v)} />
        <label className="field" htmlFor="s-act"><span>Actividad (sin datos del reloj)</span>
          <select id="s-act" className="select" value={String(profile.activity_level)} onChange={(e) => p("activity_level", Number(e.target.value))}>
            <option value="1.2">Sedentario ×1.2</option><option value="1.375">Liviano ×1.375</option><option value="1.55">Moderado ×1.55</option><option value="1.725">Muy activo ×1.725</option>
          </select>
        </label>
      </div>
      <div className="row-inputs">
        <Num label="Peso hoy" suffix="kg" value={weight} step={0.1} onChange={setWeight} />
        <Num label="Peso objetivo" suffix="kg" value={goals.weight_target_kg} step={0.1} onChange={(v) => g("weight_target_kg", v)} />
        <label className="field" htmlFor="s-wdate"><span>Para el</span><input id="s-wdate" className="input" type="date" value={goals.weight_target_date ?? ""} onChange={(e) => g("weight_target_date", e.target.value || null)} /></label>
        <Num label="Calorías" suffix="kcal/día" value={goals.kcal} step={10} onChange={(v) => g("kcal", v ?? 2000)} />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Basal {fmt(base.kcal)} · mantenimiento ≈ <b>{fmt(maintenance)}</b>
        {pace != null && <> · {pace < 0 ? "bajar" : "subir"} {Math.abs(pace).toFixed(2)} kg/semana{Math.abs(pace) > 1 ? " (más rápido de lo recomendado)" : ""}</>}
        {" · "}sugerido <b>{fmt(suggested)} kcal</b>{" "}
        <button className="btn ghost sm" onClick={() => g("kcal", suggested)}>Usar</button>
      </p>
      <div className="row-inputs">
        <Num label="Proteína" suffix="g" value={goals.protein_g} onChange={(v) => g("protein_g", v ?? 0)} />
        <Num label="Carbos" suffix="g" value={goals.carbs_g} onChange={(v) => g("carbs_g", v ?? 0)} />
        <Num label="Grasas" suffix="g" value={goals.fat_g} onChange={(v) => g("fat_g", v ?? 0)} />
        <Num label="Fibra" suffix="g" value={goals.fiber_g} onChange={(v) => g("fiber_g", v ?? 0)} />
      </div>
      <div className="macro-bar" aria-hidden="true">
        <i className="m-p" style={{ width: `${(goals.protein_g * 400) / macroKcal}%` }} />
        <i className="m-c" style={{ width: `${(goals.carbs_g * 400) / macroKcal}%` }} />
        <i className="m-f" style={{ width: `${(goals.fat_g * 900) / macroKcal}%` }} />
      </div>
      <div className="chips">
        <span className="hint">Macros suman {fmt(macroKcal)} kcal ({macroKcal - goals.kcal >= 0 ? "+" : ""}{fmt(macroKcal - goals.kcal)}) · proteína {(goals.protein_g / kg).toFixed(1)} g/kg · presets:</span>
        <button className="chip" onClick={() => preset(30, 40, 30)}>Balanceado</button>
        <button className="chip" onClick={() => preset(35, 35, 30)}>Alta proteína</button>
        <button className="chip" onClick={() => preset(30, 20, 50)}>Low carb</button>
        <button className="chip" onClick={() => preset(25, 50, 25)}>Resistencia</button>
      </div>
      <div className="row-inputs">
        <Num label="Agua" suffix="ml" value={goals.water_ml} step={50} onChange={(v) => g("water_ml", v ?? 2500)} />
        <Num label="Pasos" value={goals.steps} step={500} onChange={(v) => g("steps", v ?? 10000)} />
        <Num label="Sueño" suffix="min" value={goals.sleep_min} step={15} onChange={(v) => g("sleep_min", v ?? 450)} />
        <Num label="Series por músculo" suffix="por semana" value={goals.weekly_sets_target} onChange={(v) => g("weekly_sets_target", v ?? 10)} />
        <Num label="Cafeína máx." suffix="mg" value={goals.caffeine_max_mg} step={10} onChange={(v) => g("caffeine_max_mg", v ?? 400)} />
        <Num label="Comodines de racha" suffix="por mes" value={freezes} onChange={(v) => setFreezes(Math.max(0, Math.min(5, v ?? 0)))} />
        <label className="field" htmlFor="s-cut"><span>Corte de cafeína</span><input id="s-cut" className="input" type="time" value={goals.caffeine_cutoff?.slice(0, 5)} onChange={(e) => g("caffeine_cutoff", e.target.value)} /></label>
      </div>
      <div><button className="btn leaf" onClick={save}>Guardar objetivos</button></div>
    </Section>
  )
}

// ---------- editable lists ----------

function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const reload = useCallback(() => tilo.request<Catalog>("GET", "/catalog").then(setCat), [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { cat, setCat, reload }
}

function useSave() {
  const { toast } = useToast()
  return async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      invalidateDay(localDate())
      if (msg) toast(msg)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true })
    }
  }
}

function HabitsSection({ cat, reload }: { cat: Catalog; reload: () => void }) {
  const save = useSave()
  const patch = (id: string, values: Record<string, unknown>) => save(() => crud.update("habits", id, values))
  return (
    <Section id="habits" title="Hábitos" desc="Marcá qué días querés cumplir cada uno: esos días aparecen en Hoy y en los recordatorios. Los diarios cuentan para la racha; los semanales se cumplen con llegar a la cantidad de días marcados. Con “auto” se completan solos desde tus actividades.">
      <div className="list-edit">
        {cat.habits.map((h) => {
          const auto = h.auto_rule as { activity_types?: string[]; min_minutes?: number } | null
          return (
            <div key={h.id} className="list-row">
              <div className="inline">
                <input className="input" defaultValue={String(h.name)} aria-label="Nombre" onBlur={(e) => e.target.value !== h.name && patch(h.id, { name: e.target.value })} />
                <select className="select" defaultValue={String(h.frequency)} aria-label="Frecuencia" onChange={(e) => patch(h.id, { frequency: e.target.value }).then(reload)}>
                  <option value="daily">Diario</option><option value="weekly">Semanal</option>
                </select>
                <Days value={(h.days as number[]) ?? [0, 1, 2, 3, 4, 5, 6]} onChange={(v) => v.length && patch(h.id, { days: v, per_week: v.length }).then(reload)} />
                <input className="input" type="time" defaultValue={String(h.reminder_time ?? "").slice(0, 5)} aria-label="Hora del recordatorio" onBlur={(e) => patch(h.id, { reminder_time: e.target.value || null })} />
                <select className="select" defaultValue={auto?.activity_types?.[0] ?? ""} aria-label="Completar automáticamente" onChange={(e) => patch(h.id, { auto_rule: e.target.value ? { activity_types: [e.target.value], min_minutes: 15 } : null })}>
                  <option value="">Manual</option><option value="run">Auto: correr</option><option value="ride">Auto: bici</option><option value="swim">Auto: natación</option><option value="walk">Auto: caminar</option><option value="strength">Auto: gimnasio</option><option value="yoga">Auto: yoga</option>
                </select>
              </div>
              <button className="iconbtn" aria-label={`Archivar ${h.name}`} onClick={() => save(() => crud.update("habits", h.id, { archived: true }), "Hábito archivado").then(reload)}><Trash2 /></button>
            </div>
          )
        })}
      </div>
      <div><button className="btn ghost sm" onClick={() => save(() => crud.create("habits", { name: "Nuevo hábito", position: cat.habits.length })).then(reload)}><Plus /> Agregar hábito</button></div>
    </Section>
  )
}

function SupplementsSection({ cat, reload }: { cat: Catalog; reload: () => void }) {
  const save = useSave()
  const patch = (id: string, values: Record<string, unknown>) => save(() => crud.update("supplements", id, values))
  const have = new Set(cat.supplements.map((s) => String(s.name)))
  return (
    <Section id="supplements" title="Suplementos" desc="Aparecen en el checklist del día según el momento y los días que elijas. El stock baja solo y te avisa cuando quedan 7 dosis.">
      <div className="list-edit">
        {cat.supplements.map((s) => (
          <div key={s.id} className="list-row">
            <div className="inline">
              <input className="input" defaultValue={String(s.name)} aria-label="Nombre" onBlur={(e) => patch(s.id, { name: e.target.value })} />
              <input className="input num" type="number" step="any" defaultValue={Number(s.dose)} aria-label="Dosis" onBlur={(e) => patch(s.id, { dose: Number(e.target.value) })} />
              <select className="select" defaultValue={String(s.unit)} aria-label="Unidad" onChange={(e) => patch(s.id, { unit: e.target.value })} style={{ flex: "0 1 80px" }}>
                {["mg", "mcg", "iu", "g", "ml", "caps", "scoop"].map((u) => <option key={u} value={u}>{u === "iu" ? "UI" : u}</option>)}
              </select>
              <select className="select" defaultValue={String(s.slot)} aria-label="Momento" onChange={(e) => patch(s.id, { slot: e.target.value })}>
                {(Object.keys(SLOT_LABELS) as SupplementSlot[]).map((k) => <option key={k} value={k}>{SLOT_LABELS[k]}</option>)}
              </select>
              <Days value={(s.days as number[]) ?? []} onChange={(v) => patch(s.id, { days: v }).then(reload)} />
              <input className="input num" type="number" min={0} defaultValue={s.stock_doses == null ? "" : Number(s.stock_doses)} placeholder="stock" aria-label="Dosis en stock" onBlur={(e) => patch(s.id, { stock_doses: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
            <button className="iconbtn" aria-label={`Quitar ${s.name}`} onClick={() => save(() => crud.update("supplements", s.id, { archived: true }), "Suplemento quitado").then(reload)}><Trash2 /></button>
          </div>
        ))}
      </div>
      <div className="chips">
        <span className="hint">Agregar:</span>
        {SUPPLEMENT_PRESETS.filter((p) => !have.has(p.name)).map((p) => (
          <button
            key={p.key}
            className="chip"
            onClick={() =>
              save(() => crud.create("supplements", { name: p.name, dose: p.dose, unit: p.unit, slot: p.slot, with_food: p.withFood, nutrients: p.nutrients, position: cat.supplements.length }), `${p.name} agregado`).then(reload)
            }
          >
            + {p.name}
          </button>
        ))}
        <button className="chip" onClick={() => save(() => crud.create("supplements", { name: "Nuevo suplemento", dose: 1, unit: "caps", position: cat.supplements.length })).then(reload)}>+ Otro</button>
      </div>
    </Section>
  )
}

function RoutinesSection({ cat, reload }: { cat: Catalog; reload: () => void }) {
  const save = useSave()
  const exName = (id: unknown) => {
    const e = cat.exercises.find((x) => x.id === id)
    return e ? e.name_es ?? e.name : "?"
  }
  return (
    <Section id="routines" title="Rutinas" desc="Asigná cada rutina a días de la semana y aparece sola en Today, con lo que hiciste la última vez y cuánto subir.">
      <datalist id="exercise-list">{cat.exercises.map((e) => <option key={e.id} value={e.name_es ?? e.name} />)}</datalist>
      {cat.routines.map((r) => (
        <div key={r.id} className="card" style={{ padding: 10, display: "grid", gap: 8 }}>
          <div className="list-row" style={{ background: "none", padding: 0 }}>
            <div className="inline">
              <input className="input" defaultValue={String(r.name)} aria-label="Nombre de la rutina" onBlur={(e) => save(() => crud.update("routines", r.id, { name: e.target.value }))} style={{ fontWeight: 600 }} />
              <Days value={(r.weekdays as number[]) ?? []} onChange={(v) => save(() => crud.update("routines", r.id, { weekdays: v })).then(reload)} />
            </div>
            <button className="iconbtn" aria-label={`Archivar ${r.name}`} onClick={() => save(() => crud.update("routines", r.id, { archived: true }), "Rutina archivada").then(reload)}><Trash2 /></button>
          </div>
          {r.items.map((i) => (
            <div key={i.id} className="list-row">
              <div className="inline">
                <span style={{ flex: "1 1 160px", fontWeight: 500 }}>{exName(i.exercise_id)}</span>
                <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center" }}>series<input className="input num" type="number" min={1} defaultValue={Number(i.sets)} aria-label="Series" onBlur={(e) => save(() => crud.update("routine_items", i.id, { sets: Number(e.target.value) }))} style={{ width: 56 }} /></label>
                <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center" }}>reps<input className="input num" type="number" min={1} defaultValue={i.reps_min == null ? "" : Number(i.reps_min)} aria-label="Reps mínimas" onBlur={(e) => save(() => crud.update("routine_items", i.id, { reps_min: e.target.value ? Number(e.target.value) : null }))} style={{ width: 56 }} />–<input className="input num" type="number" min={1} defaultValue={i.reps_max == null ? "" : Number(i.reps_max)} aria-label="Reps máximas" onBlur={(e) => save(() => crud.update("routine_items", i.id, { reps_max: e.target.value ? Number(e.target.value) : null }))} style={{ width: 56 }} /></label>
                <label className="hint" style={{ display: "flex", gap: 4, alignItems: "center" }}>descanso<input className="input num" type="number" min={0} step={15} defaultValue={Number(i.rest_sec)} aria-label="Descanso en segundos" onBlur={(e) => save(() => crud.update("routine_items", i.id, { rest_sec: Number(e.target.value) }))} style={{ width: 64 }} />s</label>
              </div>
              <button className="iconbtn" aria-label="Quitar ejercicio" onClick={() => save(() => crud.remove("routine_items", i.id)).then(reload)}><Trash2 /></button>
            </div>
          ))}
          <form
            className="inline"
            style={{ display: "flex", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault()
              const input = (e.currentTarget.elements.namedItem("ex") as HTMLInputElement)
              const ex = cat.exercises.find((x) => (x.name_es ?? x.name).toLowerCase() === input.value.trim().toLowerCase())
              if (!ex) return
              input.value = ""
              void save(() => crud.create("routine_items", { routine_id: r.id, exercise_id: ex.id, position: r.items.length, sets: 3, reps_min: 8, reps_max: 12, rest_sec: 120 })).then(reload)
            }}
          >
            <input name="ex" className="input" list="exercise-list" placeholder="Agregar ejercicio (press banca, sentadilla…)" aria-label="Agregar ejercicio" />
            <button className="btn ghost sm"><Plus /> Agregar</button>
          </form>
        </div>
      ))}
      <div><button className="btn ghost sm" onClick={() => save(() => crud.create("routines", { name: "Nueva rutina", weekdays: [], position: cat.routines.length })).then(reload)}><Plus /> Nueva rutina</button></div>
    </Section>
  )
}

function ProjectsSection({ cat, reload }: { cat: Catalog; reload: () => void }) {
  const save = useSave()
  return (
    <Section id="projects" title="Proyectos" desc="Para agrupar tareas. En la barra rápida usá #proyecto.">
      <div className="list-edit">
        {cat.projects.map((p) => (
          <div key={p.id} className="list-row">
            <div className="inline">
              <input type="color" defaultValue={String(p.color)} aria-label="Color" onBlur={(e) => save(() => crud.update("projects", p.id, { color: e.target.value }))} style={{ width: 34, height: 30, border: 0, background: "none", padding: 0 }} />
              <input className="input" defaultValue={String(p.name)} aria-label="Nombre" onBlur={(e) => save(() => crud.update("projects", p.id, { name: e.target.value }))} />
            </div>
            <button className="iconbtn" aria-label={`Archivar ${p.name}`} onClick={() => save(() => crud.update("projects", p.id, { archived: true })).then(reload)}><Trash2 /></button>
          </div>
        ))}
      </div>
      <div><button className="btn ghost sm" onClick={() => save(() => crud.create("projects", { name: `Proyecto ${cat.projects.length + 1}`, position: cat.projects.length })).then(reload)}><Plus /> Agregar proyecto</button></div>
    </Section>
  )
}

// ---------- connections, AI, developer ----------

interface ConnectionsData {
  connections: { provider: string; external_id: string; account_email: string | null; display_name: string | null; scopes: string[]; status: string; last_sync_at: string | null; last_error: string | null }[]
  deviceSources: { source: string; device: string | null; last_date: string; last_steps: number | null }[]
}

const SOURCE_LABEL: Record<string, string> = { apple: "Apple Health", google_health: "Google Health", health_connect: "Health Connect (Android)", strava: "Strava", garmin: "Garmin", manual: "Manual" }

function ConnectionsSection() {
  const [data, setData] = useState<ConnectionsData | null>(null)
  const save = useSave()
  const load = useCallback(() => tilo.request<ConnectionsData>("GET", "/connections").then(setData), [])
  useEffect(() => {
    void load()
  }, [load])
  const back = encodeURIComponent("/?settings=connections")
  const has = (scope: string) => data?.connections.some((c) => c.provider === "google" && c.scopes.some((s) => s.includes(scope)))
  return (
    <Section id="connections" title="Conexiones" desc="De dónde llegan tus datos. Si dos fuentes miden lo mismo, usamos la del reloj.">
      <div><Link className="btn leaf" href="/connect">Asistente: conectá tus dispositivos</Link></div>
      <div className="list-edit">
        {data?.connections.map((c) => (
          <div key={`${c.provider}-${c.external_id}`} className="list-row">
            <div className="inline">
              <b>{c.provider === "strava" ? "Strava" : "Google"}</b>
              <span className="hint">{c.display_name ?? c.account_email}</span>
              {c.provider === "google" && (
                <span className="chips">
                  {c.scopes.some((s) => s.includes("gmail")) && <span className="pill leaf">Gmail</span>}
                  {c.scopes.some((s) => s.includes("calendar")) && <span className="pill leaf">Calendar</span>}
                  {c.scopes.some((s) => s.includes("googlehealth")) && <span className="pill leaf">Health</span>}
                </span>
              )}
              <span className={`pill ${c.status === "active" && !c.last_error ? "" : "red"}`}>{c.status === "active" && !c.last_error ? (c.last_sync_at ? `sincronizado ${new Date(c.last_sync_at).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "conectado") : `error: ${c.last_error ?? c.status}`}</span>
            </div>
            <button className="btn danger sm" onClick={() => save(() => tilo.request("DELETE", `/connections?provider=${c.provider}&id=${c.external_id}`), "Desconectado").then(load)}>Desconectar</button>
          </div>
        ))}
        {data?.deviceSources.map((s) => (
          <div key={s.source} className="list-row">
            <div className="inline">
              <b>{SOURCE_LABEL[s.source] ?? s.source}</b>
              <span className="hint">{s.device}</span>
              <span className="pill">último dato {s.last_date}{s.last_steps != null ? ` · ${fmt(s.last_steps)} pasos` : ""}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="chips">
        <a className="btn ghost sm" href={`/api/connect/strava?return=${back}`}>Conectar Strava (y Garmin vía Strava)</a>
        {!has("gmail") && <a className="btn ghost sm" href={`/api/connect/google?features=gmail,calendar&return=${back}`}>Conectar Gmail y Calendar</a>}
        {!has("googlehealth") && <a className="btn ghost sm" href={`/api/connect/google?features=health&return=${back}`}>Conectar Fitbit / Pixel Watch</a>}
      </div>
    </Section>
  )
}

function AiSection() {
  const { toast } = useToast()
  const [s, setS] = useState<{ profile: Profile; settings: { ai: { provider: string; model: string | null; hasKey: boolean } | null } } | null>(null)
  const [provider, setProvider] = useState("gemini")
  const [key, setKey] = useState("")
  const load = useCallback(() => tilo.request<typeof s>("GET", "/settings").then(setS), [])
  useEffect(() => {
    void load()
  }, [load])
  if (!s) return <Section id="ai" title="IA"><p className="hint">Cargando…</p></Section>
  const trialLeft = Math.ceil((Date.parse(s.profile.trial_ends_at) - Date.now()) / 86_400_000)
  return (
    <Section id="ai" title="IA" desc="La IA estima comidas, ordena tu mail y escribe tus revisiones. Todo lo demás funciona sin IA.">
      <p style={{ margin: 0 }}>
        {s.profile.plan === "pro" ? <span className="pill leaf">Tilo Pro</span> : s.profile.plan === "trial" && trialLeft > 0 ? <span className="pill leaf">Prueba gratis: quedan {trialLeft} días</span> : <span className="pill warn">Plan gratis: IA con tu propia key o vía MCP</span>}
      </p>
      <div className="reco" style={{ margin: 0 }}>
        <span><b>Gratis para siempre:</b> conectá Tilo a Claude, ChatGPT, Copilot o Gemini (sección VSCode y MCP) y usá tu propia suscripción de IA para registrar comidas y pedir análisis.</span>
      </div>
      {s.settings.ai?.hasKey ? (
        <div className="list-row">
          <div className="inline"><b>Tu key de {s.settings.ai.provider}</b><span className="hint">guardada cifrada</span></div>
          <button className="btn danger sm" onClick={async () => { await tilo.request("PATCH", "/settings", { ai: null }); toast("Key borrada"); void load() }}>Borrar</button>
        </div>
      ) : (
        <form
          className="row-inputs"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await tilo.request("PATCH", "/settings", { ai: { provider, key } })
              setKey("")
              toast("Key guardada: tu IA no tiene límites de Tilo")
              void load()
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), { error: true })
            }
          }}
        >
          <label className="field" htmlFor="ai-provider"><span>Proveedor</span>
            <select id="ai-provider" className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label className="field" htmlFor="ai-key"><span>API key</span><input id="ai-key" className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="pegá tu key" /></label>
          <div className="field"><span>&nbsp;</span><button className="btn leaf" disabled={key.length < 20}>Guardar key</button></div>
        </form>
      )}
    </Section>
  )
}

function DeveloperSection() {
  const { toast } = useToast()
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([])
  const [fresh, setFresh] = useState<string | null>(null)
  const load = useCallback(() => tilo.request<ApiTokenInfo[]>("GET", "/tokens").then(setTokens).catch(() => {}), [])
  useEffect(() => {
    void load()
  }, [load])
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast("Copiado"), () => toast("Seleccioná y copiá a mano", { error: true }))
  return (
    <Section id="developer" title="VSCode y MCP" desc="Usá Tilo desde tu editor y desde tu IA.">
      <div className="list-edit">
        <div className="list-row"><div className="inline"><b>MCP remoto</b><span className="token">{origin}/api/mcp</span><span className="hint">Pegalo en Claude (Settings → Connectors), ChatGPT (Connectors) o Copilot. Inicia sesión con tu cuenta, sin tokens.</span></div><button className="iconbtn" aria-label="Copiar URL del MCP" onClick={() => copy(`${origin}/api/mcp`)}><Copy /></button></div>
        <div className="list-row"><div className="inline"><b>Extensión de VSCode</b><span className="hint">Instalá “Tilo” y corré “Tilo: Set API Token” con un token de acá.</span></div></div>
      </div>
      <div><button className="btn leaf sm" onClick={async () => { const r = await tilo.request<{ token: string }>("POST", "/tokens", { name: "VSCode / MCP local" }); setFresh(r.token); void load() }}>Generar token</button></div>
      {fresh && (
        <div className="reco" style={{ margin: 0 }}>
          <span style={{ flex: 1 }}>Copialo ahora, no se vuelve a mostrar: <span className="token">{fresh}</span></span>
          <button className="iconbtn" aria-label="Copiar token" onClick={() => copy(fresh)}><Copy /></button>
        </div>
      )}
      <div className="list-edit">
        {tokens.map((t) => (
          <div key={t.id} className="list-row">
            <div className="inline"><b>{t.name}</b><span className="token">{t.preview}</span><span className="hint">{t.kind === "mcp_oauth" ? "MCP (OAuth)" : t.kind === "ingest" ? "sincronización" : "personal"} · usado {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString("es-AR") : "nunca"}</span></div>
            <button className="iconbtn" aria-label={`Revocar ${t.name}`} onClick={async () => { await tilo.request("DELETE", `/tokens/${t.id}`); toast("Token revocado"); void load() }}><Trash2 /></button>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>Las pausas activas, recordatorios y la status bar se configuran en la extensión de VSCode (Tilo: Open Settings).</p>
    </Section>
  )
}

function SettingsBody({ initial }: { initial: string }) {
  const { cat, reload } = useCatalog()
  useEffect(() => {
    const el = document.getElementById(`settings-${initial}`)
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50)
  }, [initial, cat])
  return (
    <>
      <nav className="settings-nav" aria-label="Secciones de settings">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className="chip" onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{label}</button>
        ))}
      </nav>
      <GoalsSection />
      {cat ? (
        <>
          <HabitsSection cat={cat} reload={reload} />
          <SupplementsSection cat={cat} reload={reload} />
          <RoutinesSection cat={cat} reload={reload} />
          <ProjectsSection cat={cat} reload={reload} />
        </>
      ) : (
        <p className="hint">Cargando…</p>
      )}
      <ConnectionsSection />
      <AiSection />
      <DeveloperSection />
    </>
  )
}

export function SettingsDrawer({ initial, onClose }: { initial: string; onClose: () => void }) {
  return (
    <Drawer title="Settings" wide onClose={onClose}>
      <ToastProvider>
        <SettingsBody initial={initial} />
      </ToastProvider>
    </Drawer>
  )
}
