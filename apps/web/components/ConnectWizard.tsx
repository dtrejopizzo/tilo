"use client"

import type { Goals, Profile } from "@tilo/core/apiTypes"
import { ageFrom, bmr } from "@tilo/core/energy"
import { SLOT_LABELS, SUPPLEMENT_PRESETS, type SupplementSlot, type SupplementUnit } from "@tilo/core/supplements"
import { CircleCheck, Loader2, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { crud, fmt, localDate, tilo } from "@/lib/client/api"
import { invalidateDay } from "@/lib/client/useDay"

// Onboarding: welcome → 1 about you → 2 connect → 3 goals → 4 habits & supplements → done.
// Every step is detected from the account, so someone who already did part of it lands on what's missing.

type StepId = 1 | 2 | 3 | 4
type Screen = "loading" | "welcome" | StepId | "done"

interface Conns {
  connections: { provider: string; scopes: string[]; display_name: string | null; last_error: string | null }[]
  deviceSources: { source: string; device: string | null; last_date: string; last_steps: number | null }[]
}
interface Onboarding { connect?: boolean; goals?: boolean; habits?: boolean }
interface SettingsRes { profile: Profile; goals: Goals; settings: { onboarding?: Onboarding } }
interface Catalog {
  habits: { id: string; name: string; frequency: string; per_week: number; reminder_time: string | null }[]
  supplements: { id: string; name: string }[]
}
interface HabitRow { name: string; frequency: "daily" | "weekly"; per_week: number; reminder_time: string; auto: string }
interface SuppRow { name: string; dose: number; unit: SupplementUnit; slot: SupplementSlot; days: number[]; with_food: boolean; nutrients: Record<string, number> | null }
const UNITS: SupplementUnit[] = ["mg", "mcg", "iu", "g", "ml", "caps", "scoop"]
const SUPP_SUGGESTED = ["vitamin_c", "whey", "electrolytes"]
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"]

function Days({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <span className="days" role="group" aria-label="Días de la semana">
      {WEEKDAYS.map((d, i) => (
        <button key={i} type="button" aria-pressed={value.includes(i)} onClick={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())}>{d}</button>
      ))}
    </span>
  )
}

const STEPS: { id: StepId; title: string; short: string }[] = [
  { id: 1, title: "Sobre vos", short: "Vos" },
  { id: 2, title: "Conectá tus datos", short: "Datos" },
  { id: 3, title: "Objetivos", short: "Objetivos" },
  { id: 4, title: "Hábitos y suplementos", short: "Hábitos" },
]

const HABIT_PRESETS: { name: string; auto?: string; weekly?: number }[] = [
  { name: "Entrenar", auto: "strength", weekly: 3 },
  { name: "Correr", auto: "run", weekly: 3 },
  { name: "Nadar", auto: "swim", weekly: 2 },
  { name: "Caminar 30 min", auto: "walk" },
  { name: "Leer", },
  { name: "Meditar" },
  { name: "Estirar" },
  { name: "Ir a misa", weekly: 1 },
  { name: "Dormir 7 h o más" },
  { name: "Sin pantallas antes de dormir" },
]

const CONFETTI_COLORS = ["#2f9e5f", "#8a5cd6", "#2f7fe0", "#d48a1c", "#e8899a", "#1fa6b8", "#f2c94c"]

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2.5,
        dur: 3 + Math.random() * 2.5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 6 + Math.random() * 6,
        rot: Math.random() * 360,
        round: i % 3 === 0,
      })),
    [],
  )
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color,
            width: p.w, height: p.round ? p.w : p.w * 1.6, borderRadius: p.round ? "50%" : 2, transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  )
}

function Tilo({ size = 140 }: { size?: number }) {
  return <img src="/icon.svg" alt="" className="mascot" width={size} height={size} />
}

function Card({ title, done, children, action, hint }: { title: string; done?: boolean; children: ReactNode; action?: ReactNode; hint?: string }) {
  return (
    <div className={`pstep${done ? " ok" : ""}`}>
      <span className="n">{done ? "✓" : "·"}</span>
      <div>
        <h4>{title}</h4>
        {children}
        {hint && <p style={{ marginTop: 4, color: "var(--danger)" }}>{hint}</p>}
      </div>
      {action}
    </div>
  )
}

function Num({ id, label, value, onChange, step = 1, suffix, min, max }: { id: string; label: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: number; suffix?: string; min?: number; max?: number }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}{suffix ? ` (${suffix})` : ""}</span>
      <input id={id} className="input num" type="number" inputMode="decimal" step={step} min={min} max={max} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </label>
  )
}

export function ConnectWizard() {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>("loading")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [goals, setGoals] = useState<Goals | null>(null)
  const [ob, setOb] = useState<Onboarding>({})
  const [conns, setConns] = useState<Conns | null>(null)
  const [cat, setCat] = useState<Catalog>({ habits: [], supplements: [] })
  const [weight, setWeight] = useState<number | null>(null)
  const [savedWeight, setSavedWeight] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const today = localDate()

  const poll = useCallback(() => tilo.request<Conns>("GET", "/connections").then(setConns).catch(() => {}), [])
  const loadCatalog = useCallback(() => tilo.request<Catalog>("GET", "/catalog").then(setCat).catch(() => {}), [])

  useEffect(() => {
    setMounted(true)
    Promise.all([
      tilo.request<SettingsRes>("GET", "/settings"),
      tilo.request<Conns>("GET", "/connections").catch(() => null),
      tilo.request<Catalog>("GET", "/catalog").catch(() => ({ habits: [], supplements: [] })),
      tilo.getDay(localDate()).catch(() => null),
    ]).then(([s, c, catalog, day]) => {
      setProfile(s.profile)
      setGoals(s.goals)
      setOb(s.settings.onboarding ?? {})
      setConns(c)
      setCat(catalog)
      const kg = day?.weight ? Number(day.weight.kg) : null
      setWeight(kg)
      setSavedWeight(kg)
      setScreen("welcome")
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // While connecting, the OAuth tab comes back here: keep the connection list fresh
  useEffect(() => {
    if (screen !== 2) return
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [screen, poll])

  // After an OAuth round trip (?connected=strava), reopen the connect step directly
  useEffect(() => {
    if (screen !== "welcome") return
    const q = new URLSearchParams(window.location.search)
    const wanted = Number(q.get("step"))
    if (q.get("connected") || q.get("connect_error")) {
      if (q.get("connect_error")) setError(q.get("connect_error"))
      setScreen(2)
      window.history.replaceState(null, "", "/connect")
    } else if (wanted >= 1 && wanted <= 4) {
      setScreen(wanted as StepId)
      window.history.replaceState(null, "", "/connect")
    }
  }, [screen])

  const has = (provider: string, scope?: string) => !!conns?.connections.some((c) => c.provider === provider && (!scope || c.scopes.some((s) => s.includes(scope))))
  const connError = (provider: string) => conns?.connections.find((c) => c.provider === provider)?.last_error ?? undefined

  const done: Record<StepId, boolean> = {
    1: !!(profile?.sex && profile.birth_date && profile.height_cm && savedWeight != null),
    2: !!ob.connect || (conns?.connections.length ?? 0) > 0,
    3: !!ob.goals,
    4: !!ob.habits || cat.habits.length > 0,
  }
  const missing = STEPS.filter((s) => !done[s.id])
  const firstMissing: Screen = missing[0]?.id ?? "done"
  const nextAfter = (id: StepId): Screen => STEPS.find((s) => s.id > id && !done[s.id])?.id ?? (STEPS.find((s) => s.id > id)?.id ?? "done")

  async function run(fn: () => Promise<unknown>, then: Screen) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (then === "done") await tilo.request("PATCH", "/settings", { profile: { onboarding_done: true } })
      invalidateDay(today)
      setScreen(then)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveOb = async (patch: Onboarding) => {
    const next = { ...ob, ...patch }
    await tilo.request("PATCH", "/settings", { settings: { onboarding: next } })
    setOb(next)
  }

  // ---------- step 1: about you ----------
  const saveProfile = () =>
    run(async () => {
      if (!profile) return
      await tilo.request("PATCH", "/settings", {
        profile: { sex: profile.sex ?? null, birth_date: profile.birth_date || null, height_cm: profile.height_cm ?? null, body_fat_pct: profile.body_fat_pct ?? null },
      })
      if (weight != null && weight !== savedWeight) {
        await tilo.addWeight(weight, undefined, today)
        setSavedWeight(weight)
      }
    }, nextAfter(1))

  // ---------- step 3: goals ----------
  const kg = weight ?? savedWeight ?? 75
  const base = profile ? bmr({ sex: profile.sex, ageYears: ageFrom(profile.birth_date, today), heightCm: profile.height_cm, bodyFatPct: profile.body_fat_pct, activityLevel: Number(profile.activity_level) }, kg) : null
  const maintenance = base ? Math.round(base.kcal * Number(profile?.activity_level ?? 1.375)) : 2200
  const days = goals?.weight_target_date ? Math.max(1, (Date.parse(goals.weight_target_date) - Date.now()) / 86_400_000) : null
  const delta = goals?.weight_target_kg != null && days ? ((Number(goals.weight_target_kg) - kg) * 7700) / days : 0
  const suggested = Math.max(1200, Math.round((maintenance + delta) / 10) * 10)
  const pace = goals?.weight_target_kg != null && days ? ((Number(goals.weight_target_kg) - kg) / days) * 7 : null
  const g = (k: keyof Goals, v: unknown) => goals && setGoals({ ...goals, [k]: v })
  const macros = (pp: number, cc: number, ff: number) =>
    goals && setGoals({ ...goals, protein_g: Math.round((goals.kcal * pp) / 400), carbs_g: Math.round((goals.kcal * cc) / 400), fat_g: Math.round((goals.kcal * ff) / 900) })
  const saveGoals = () =>
    run(async () => {
      if (!goals) return
      const { updated_at: _u, user_id: _uid, ...patch } = goals as Goals & Record<string, unknown>
      void _u; void _uid
      await tilo.request("PATCH", "/settings", { goals: patch })
      await saveOb({ goals: true })
    }, nextAfter(3))

  // ---------- step 4: habits & supplements ----------
  const [habitRows, setHabitRows] = useState<HabitRow[]>([])
  const [suppRows, setSuppRows] = useState<SuppRow[]>([])
  const haveHabit = (name: string) => cat.habits.some((h) => h.name.toLowerCase() === name.trim().toLowerCase())
  const haveSupp = (name: string) => cat.supplements.some((x) => x.name.toLowerCase() === name.trim().toLowerCase())
  const addHabitRow = (r: Partial<HabitRow> = {}) => setHabitRows((rows) => [...rows, { name: "", frequency: "daily", per_week: 3, reminder_time: "", auto: "", ...r }])
  const addSuppRow = (r: Partial<SuppRow> = {}) => setSuppRows((rows) => [...rows, { name: "", dose: 1, unit: "caps", slot: "breakfast", days: [0, 1, 2, 3, 4, 5, 6], with_food: false, nutrients: null, ...r }])
  const patchHabit = (i: number, v: Partial<HabitRow>) => setHabitRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...v } : r)))
  const patchSupp = (i: number, v: Partial<SuppRow>) => setSuppRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...v } : r)))
  const pendingCount = habitRows.filter((r) => r.name.trim()).length + suppRows.filter((r) => r.name.trim()).length
  const saveHabits = () =>
    run(async () => {
      let pos = cat.habits.length
      for (const r of habitRows) {
        const name = r.name.trim()
        if (!name || haveHabit(name)) continue
        await crud.create("habits", {
          name, position: pos++, frequency: r.frequency, per_week: r.frequency === "daily" ? 7 : r.per_week,
          reminder_time: r.reminder_time || null,
          auto_rule: r.auto ? { activity_types: [r.auto], min_minutes: 15 } : null,
        })
      }
      let spos = cat.supplements.length
      for (const r of suppRows) {
        const name = r.name.trim()
        if (!name || haveSupp(name) || !r.days.length) continue
        await crud.create("supplements", { name, dose: r.dose, unit: r.unit, slot: r.slot, days: r.days, with_food: r.with_food, nutrients: r.nutrients, position: spos++ })
      }
      await loadCatalog()
      await saveOb({ habits: true })
    }, nextAfter(4))

  const finish = () => run(async () => {}, "done")

  const firstName = (profile?.name ?? "").split(" ")[0]
  const anyData = (conns?.deviceSources.length ?? 0) > 0 || has("strava")
  const back = encodeURIComponent("/connect")

  if (screen === "loading") {
    return (
      <main className="main">
        <div className="wizard"><div className="verify wait"><Loader2 aria-hidden="true" className="spin" /><b>Preparando tu cuenta…</b></div>{error && <p className="bad">{error}</p>}</div>
      </main>
    )
  }

  if (screen === "welcome") {
    const fresh = missing.length === STEPS.length
    return (
      <main className="main">
        {mounted && <Confetti />}
        <div className="wizard welcome">
          <Tilo />
          <h1>{fresh ? `¡Bienvenido${firstName ? `, ${firstName}` : ""}!` : `¡Qué bueno verte${firstName ? `, ${firstName}` : ""}!`}</h1>
          {fresh ? (
            <p>Soy Tilo. Voy a ayudarte a dejar todo listo en unos minutos: tus datos, tus dispositivos, tus objetivos y tus hábitos. Después, cada día cuenta solo.</p>
          ) : missing.length ? (
            <p>Ya tenés {STEPS.length - missing.length} de {STEPS.length} pasos listos. Te {missing.length === 1 ? "falta" : "faltan"} <b>{missing.map((m) => m.title.toLowerCase()).join(", ")}</b>.</p>
          ) : (
            <p>Tenés todo configurado. Podés repasar cualquier paso o ir directo a tu día.</p>
          )}
          <div className="stepper" role="list">
            {STEPS.map((s) => (
              <button key={s.id} role="listitem" className={done[s.id] ? "ok" : ""} onClick={() => setScreen(s.id)}>
                <span className="n">{done[s.id] ? "✓" : s.id}</span>{s.short}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn leaf" onClick={() => setScreen(firstMissing)}>{fresh ? "Empezar" : missing.length ? "Completar lo que falta" : "Ir a mi día"}</button>
            {!fresh && missing.length > 0 && <button className="btn ghost" onClick={finish}>Terminar después</button>}
          </div>
        </div>
      </main>
    )
  }

  if (screen === "done") {
    return (
      <main className="main">
        {mounted && <Confetti />}
        <div className="wizard welcome">
          <Tilo />
          <h1>¡Listo{firstName ? `, ${firstName}` : ""}!</h1>
          <p>Tu cuenta quedó configurada. Lo que conectaste llega solo; lo demás lo cargás desde Today escribiendo cosas como “peso 81.6”, “+500” de agua o “3x8 80kg”.</p>
          <button className="btn leaf" onClick={() => router.push("/")}>Ir a Today</button>
        </div>
      </main>
    )
  }

  const step = screen
  const current = STEPS.find((s) => s.id === step)!
  const stepper = (
    <div className="stepper" role="list" aria-label="Pasos">
      {STEPS.map((s) => (
        <button key={s.id} role="listitem" className={done[s.id] ? "ok" : ""} aria-current={s.id === step ? "step" : undefined} onClick={() => setScreen(s.id)}>
          <span className="n">{done[s.id] ? "✓" : s.id}</span>{s.short}
        </button>
      ))}
    </div>
  )
  const skip = (id: StepId) => <button className="btn ghost" disabled={busy} onClick={() => setScreen(nextAfter(id))}>Omitir por ahora</button>

  return (
    <main className="main">
      <div className="wizard">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Tilo size={56} />
          <div>
            <h1 style={{ margin: "0 0 2px", fontSize: 22 }}>{current.title}</h1>
            <p className="hint" style={{ margin: 0, fontSize: 13 }}>Paso {step} de {STEPS.length}</p>
          </div>
        </div>
        {stepper}
        {error && <p className="bad" style={{ margin: 0 }}>{error}</p>}

        {step === 1 && profile && (
          <section className="section">
            <h3>Con esto calculamos tu metabolismo basal</h3>
            <p>Sin estos datos el gasto calórico es una estimación. Si conectás Google Health, la altura y el peso de tu balanza se actualizan solos.</p>
            <div className="row-inputs">
              <label className="field" htmlFor="w-sex"><span>Sexo</span>
                <select id="w-sex" className="select" value={profile.sex ?? ""} onChange={(e) => setProfile({ ...profile, sex: (e.target.value || null) as Profile["sex"] })}>
                  <option value="">—</option><option value="male">Masculino</option><option value="female">Femenino</option>
                </select>
              </label>
              <label className="field" htmlFor="w-birth"><span>Fecha de nacimiento</span><input id="w-birth" className="input" type="date" value={profile.birth_date ?? ""} onChange={(e) => setProfile({ ...profile, birth_date: e.target.value || null })} /></label>
              <Num id="w-h" label="Altura" suffix="cm" value={profile.height_cm} min={80} max={260} onChange={(v) => setProfile({ ...profile, height_cm: v })} />
              <Num id="w-w" label="Peso hoy" suffix="kg" value={weight} step={0.1} min={20} max={400} onChange={setWeight} />
              <Num id="w-bf" label="Grasa corporal (opcional)" suffix="%" value={profile.body_fat_pct} step={0.1} min={2} max={70} onChange={(v) => setProfile({ ...profile, body_fat_pct: v })} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn leaf" disabled={busy || !profile.sex || !profile.birth_date || !profile.height_cm} onClick={saveProfile}>{busy ? "Guardando…" : "Seguir"}</button>
              {skip(1)}
            </div>
          </section>
        )}

        {step === 2 && (
          <>
            <p className="hint" style={{ margin: 0 }}>Cada conexión abre una ventana de permisos y vuelve acá. Podés conectar una, todas o ninguna.</p>
            <div style={{ display: "grid", gap: 10 }}>
              <Card title="Strava (y Garmin, Coros, Polar, Apple Watch vía Strava)" done={has("strava")} hint={connError("strava")}
                action={!has("strava") ? <a className="btn leaf sm" href={`/api/connect/strava?return=${back}`}>Conectar</a> : undefined}>
                <p>Entrenamientos con frecuencia cardíaca y calorías del reloj. Importamos los últimos 30 días y después cada actividad al instante. Al autorizar, dejá marcado <b>“Ver datos de tus actividades privadas”</b>.</p>
              </Card>
              <Card title="Google Health (Fitbit, Pixel Watch, Health Connect)" done={has("google", "googlehealth")} hint={connError("google")}
                action={!has("google", "googlehealth") ? <a className="btn leaf sm" href={`/api/connect/google?features=health&return=${back}`}>Conectar</a> : undefined}>
                <p>Pasos, distancia, energía activa, FC en reposo y <b>sueño</b>. También el <b>peso y la grasa corporal</b> de balanzas digitales y la altura, de cualquier app del celu que escriba en Health Connect.</p>
              </Card>
              <Card title="Gmail y Calendar" done={has("google", "gmail")}
                action={!has("google", "gmail") ? <a className="btn ghost sm" href={`/api/connect/google?features=gmail,calendar&return=${back}`}>Conectar</a> : undefined}>
                <p>Tus reuniones en Today y un resumen diario de la bandeja: personales vs. newsletters, cuáles esperan respuesta. Nunca guardamos el contenido de los mails.</p>
              </Card>
            </div>
            <div className={`verify${anyData ? "" : " wait"}`}>
              {anyData ? <CircleCheck aria-hidden="true" /> : <Loader2 aria-hidden="true" className="spin" />}
              <div style={{ flex: 1 }}>
                <b>{anyData ? "Recibimos tus datos" : conns?.connections.length ? "Esperando datos…" : "Nada conectado todavía"}</b>
                <div className="hint">
                  {anyData
                    ? [
                        ...(conns?.deviceSources ?? []).map((s) => `${s.device ?? s.source}: ${s.last_steps != null ? `${fmt(s.last_steps)} pasos` : "datos"} (${s.last_date})`),
                        ...(has("strava") ? ["Strava conectado"] : []),
                      ].join(" · ")
                    : "Esta pantalla se actualiza sola cuando llegan."}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn leaf" disabled={busy} onClick={() => run(() => saveOb({ connect: true }), nextAfter(2))}>{conns?.connections.length ? "Seguir" : "Seguir sin conectar"}</button>
            </div>
          </>
        )}

        {step === 3 && goals && (
          <>
            <section className="section">
              <h3>Peso</h3>
              <p>Opcional. Con un objetivo y una fecha, Tilo calcula las calorías para llegar a un ritmo sano.</p>
              <div className="row-inputs">
                <Num id="g-wt" label="Peso objetivo" suffix="kg" value={goals.weight_target_kg} step={0.1} onChange={(v) => g("weight_target_kg", v)} />
                <label className="field" htmlFor="g-wdate"><span>Para el</span><input id="g-wdate" className="input" type="date" value={goals.weight_target_date ?? ""} onChange={(e) => g("weight_target_date", e.target.value || null)} /></label>
              </div>
              {pace != null && <p className="hint" style={{ margin: 0 }}>{pace < 0 ? "Bajar" : "Subir"} {Math.abs(pace).toFixed(2)} kg por semana{Math.abs(pace) > 1 ? " · más rápido de lo recomendado, probá con más tiempo" : ""}.</p>}
            </section>
            <section className="section">
              <h3>Comidas</h3>
              <p>Basal {fmt(base?.kcal ?? 0)} kcal · mantenimiento ≈ <b>{fmt(maintenance)}</b> · sugerido <b>{fmt(suggested)} kcal</b> <button className="btn ghost sm" onClick={() => g("kcal", suggested)}>Usar</button></p>
              <div className="row-inputs">
                <Num id="g-kcal" label="Calorías" suffix="kcal/día" value={goals.kcal} step={10} onChange={(v) => g("kcal", v ?? suggested)} />
                <Num id="g-p" label="Proteína" suffix="g" value={goals.protein_g} onChange={(v) => g("protein_g", v ?? 0)} />
                <Num id="g-c" label="Carbos" suffix="g" value={goals.carbs_g} onChange={(v) => g("carbs_g", v ?? 0)} />
                <Num id="g-f" label="Grasas" suffix="g" value={goals.fat_g} onChange={(v) => g("fat_g", v ?? 0)} />
                <Num id="g-fi" label="Fibra" suffix="g" value={goals.fiber_g} onChange={(v) => g("fiber_g", v ?? 30)} />
              </div>
              <div className="picks">
                <span className="hint">Repartir macros:</span>
                <button className="pick" onClick={() => macros(30, 40, 30)}>Balanceado 30/40/30</button>
                <button className="pick" onClick={() => macros(35, 35, 30)}>Alto en proteína</button>
                <button className="pick" onClick={() => macros(35, 25, 40)}>Bajo en carbos</button>
                <button className="pick" onClick={() => g("protein_g", Math.round(kg * 1.8))}>Proteína 1.8 g/kg</button>
              </div>
            </section>
            <section className="section">
              <h3>Agua, pasos y sueño</h3>
              <div className="row-inputs">
                <Num id="g-w" label="Agua" suffix="ml/día" value={goals.water_ml} step={100} onChange={(v) => g("water_ml", v ?? 2500)} />
                <Num id="g-s" label="Pasos" suffix="por día" value={goals.steps} step={500} onChange={(v) => g("steps", v ?? 10000)} />
                <Num id="g-sl" label="Sueño" suffix="horas" value={Math.round((goals.sleep_min / 60) * 10) / 10} step={0.5} onChange={(v) => g("sleep_min", Math.round((v ?? 7.5) * 60))} />
                <Num id="g-caf" label="Cafeína máx." suffix="mg" value={goals.caffeine_max_mg} step={50} onChange={(v) => g("caffeine_max_mg", v ?? 400)} />
              </div>
              <div className="picks">
                <span className="hint">Agua sugerida:</span>
                <button className="pick" onClick={() => g("water_ml", Math.round((kg * 35) / 100) * 100)}>{fmt(Math.round((kg * 35) / 100) * 100)} ml (35 ml/kg)</button>
              </div>
            </section>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn leaf" disabled={busy} onClick={saveGoals}>{busy ? "Guardando…" : "Guardar y seguir"}</button>
              {skip(3)}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <section className="section">
              <h3>Hábitos</h3>
              <p>Cargá todos los que quieras. Los diarios cuentan para la racha; los semanales tienen una meta de veces por semana. La hora sirve para los recordatorios y “auto” los completa solos con tus entrenamientos.</p>
              <div className="picks">
                <span className="hint">Sugeridos:</span>
                {HABIT_PRESETS.map((h) => (
                  <button key={h.name} className="pick" disabled={haveHabit(h.name) || habitRows.some((r) => r.name === h.name)} onClick={() => addHabitRow({ name: h.name, frequency: h.weekly ? "weekly" : "daily", per_week: h.weekly ?? 3, auto: h.auto ?? "" })}>+ {h.name}</button>
                ))}
              </div>
              {cat.habits.length > 0 && (
                <div className="list-edit">
                  {cat.habits.map((h) => (
                    <div key={h.id} className="list-row" style={{ opacity: .75 }}>
                      <div className="inline"><CircleCheck aria-hidden="true" style={{ width: 16, height: 16, color: "var(--leaf)" }} /><span>{h.name}</span><span className="hint">{h.frequency === "weekly" ? `${h.per_week}× por semana` : "diario"}{h.reminder_time ? ` · ${String(h.reminder_time).slice(0, 5)}` : ""}</span></div>
                      <span className="hint">ya cargado</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="list-edit">
                {habitRows.map((r, i) => (
                  <div key={i} className="list-row">
                    <div className="inline">
                      <input className="input" placeholder="Hábito (ej: Nadar)" aria-label="Nombre" value={r.name} onChange={(e) => patchHabit(i, { name: e.target.value })} />
                      <select className="select" aria-label="Frecuencia" value={r.frequency} onChange={(e) => patchHabit(i, { frequency: e.target.value as HabitRow["frequency"] })}>
                        <option value="daily">Todos los días</option><option value="weekly">Por semana</option>
                      </select>
                      {r.frequency === "weekly" && <input className="input num" type="number" min={1} max={7} aria-label="Veces por semana" value={r.per_week} onChange={(e) => patchHabit(i, { per_week: Math.min(7, Math.max(1, Number(e.target.value) || 1)) })} />}
                      {r.frequency === "weekly" && <span className="hint">veces/sem</span>}
                      <input className="input" type="time" aria-label="Hora del recordatorio" value={r.reminder_time} onChange={(e) => patchHabit(i, { reminder_time: e.target.value })} />
                      <select className="select" aria-label="Completar automáticamente" value={r.auto} onChange={(e) => patchHabit(i, { auto: e.target.value })}>
                        <option value="">Manual</option><option value="run">Auto: correr</option><option value="ride">Auto: bici</option><option value="swim">Auto: natación</option><option value="walk">Auto: caminar</option><option value="strength">Auto: gimnasio</option><option value="yoga">Auto: yoga</option>
                      </select>
                    </div>
                    <button className="iconbtn" aria-label="Quitar" onClick={() => setHabitRows((rows) => rows.filter((_, j) => j !== i))}><X /></button>
                  </div>
                ))}
              </div>
              <div><button className="btn ghost sm" onClick={() => addHabitRow()}><Plus /> Agregar hábito</button></div>
            </section>
            <section className="section">
              <h3>Suplementos</h3>
              <p>Opcional. Con el momento del día y los días de la semana, Tilo te los recuerda y suma sus nutrientes.</p>
              <div className="picks">
                <span className="hint">Sugeridos:</span>
                {SUPPLEMENT_PRESETS.filter((p) => SUPP_SUGGESTED.includes(p.key)).map((p) => (
                  <button key={p.key} className="pick" disabled={haveSupp(p.name) || suppRows.some((r) => r.name === p.name)} onClick={() => addSuppRow({ name: p.name, dose: p.dose, unit: p.unit, slot: p.slot, with_food: p.withFood, nutrients: p.nutrients })}>+ {p.name} · {p.dose} {p.unit}</button>
                ))}
              </div>
              {cat.supplements.length > 0 && <p className="hint" style={{ margin: 0 }}>Ya tenés: {cat.supplements.map((x) => x.name).join(", ")}.</p>}
              <div className="list-edit">
                {suppRows.map((r, i) => (
                  <div key={i} className="list-row">
                    <div className="inline">
                      <input className="input" placeholder="Suplemento" aria-label="Nombre" value={r.name} onChange={(e) => patchSupp(i, { name: e.target.value })} />
                      <input className="input num" type="number" min={0} step="any" aria-label="Dosis" value={r.dose} onChange={(e) => patchSupp(i, { dose: Number(e.target.value) || 0 })} />
                      <select className="select" aria-label="Unidad" value={r.unit} onChange={(e) => patchSupp(i, { unit: e.target.value as SupplementUnit })}>
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <select className="select" aria-label="Momento del día" value={r.slot} onChange={(e) => patchSupp(i, { slot: e.target.value as SupplementSlot })}>
                        {(Object.keys(SLOT_LABELS) as SupplementSlot[]).map((k) => <option key={k} value={k}>{SLOT_LABELS[k]}</option>)}
                      </select>
                      <Days value={r.days} onChange={(days) => patchSupp(i, { days })} />
                      <label className="hint" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={r.with_food} onChange={(e) => patchSupp(i, { with_food: e.target.checked })} /> con comida</label>
                    </div>
                    <button className="iconbtn" aria-label="Quitar" onClick={() => setSuppRows((rows) => rows.filter((_, j) => j !== i))}><X /></button>
                  </div>
                ))}
              </div>
              <div><button className="btn ghost sm" onClick={() => addSuppRow()}><Plus /> Agregar suplemento</button></div>
            </section>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn leaf" disabled={busy} onClick={saveHabits}>{busy ? "Guardando…" : pendingCount ? `Agregar ${pendingCount} y terminar` : "Terminar"}</button>
              {skip(4)}
            </div>
          </>
        )}

      </div>
    </main>
  )
}
