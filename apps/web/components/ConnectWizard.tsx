"use client"

import { CircleCheck, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { fmt, localDate, tilo } from "@/lib/client/api"

type Device = "garmin" | "watch" | "fitbit" | "strava" | "none"

const DEVICES: { id: Device; name: string; hint: string }[] = [
  { id: "garmin", name: "Garmin", hint: "vía Strava, automático" },
  { id: "watch", name: "Otro reloj (Apple, Coros, Polar…)", hint: "sus entrenamientos llegan por Strava" },
  { id: "fitbit", name: "Fitbit / Pixel Watch", hint: "pasos, energía y FC con Google Health" },
  { id: "strava", name: "Strava", hint: "actividades al instante" },
  { id: "none", name: "Nada por ahora", hint: "cargás todo a mano" },
]

interface Conns {
  connections: { provider: string; scopes: string[]; display_name: string | null }[]
  deviceSources: { source: string; device: string | null; last_date: string; last_steps: number | null }[]
}

function Step({ n, done, title, children, action }: { n: number; done?: boolean; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`pstep${done ? " ok" : ""}`}>
      <span className="n">{done ? "✓" : n}</span>
      <div>
        <h4>{title}</h4>
        {children}
      </div>
      {action}
    </div>
  )
}

export function ConnectWizard() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [me, setMe] = useState({ sex: "", birth_date: "", height_cm: "", weight: "" })
  const [selected, setSelected] = useState<Device[]>([])
  const [conns, setConns] = useState<Conns | null>(null)
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  const poll = useCallback(() => tilo.request<Conns>("GET", "/connections").then(setConns).catch(() => {}), [])
  useEffect(() => {
    void poll()
    tilo.request<{ profile: { sex: string | null; birth_date: string | null; height_cm: number | null } }>("GET", "/settings").then((r) =>
      setMe((m) => ({ ...m, sex: r.profile.sex ?? "", birth_date: r.profile.birth_date ?? "", height_cm: r.profile.height_cm ? String(r.profile.height_cm) : "" })),
    )
    setSelected(["strava"])
  }, [poll])
  useEffect(() => {
    if (step !== 2) return
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [step, poll])

  const has = (provider: string, scope?: string) => conns?.connections.some((c) => c.provider === provider && (!scope || c.scopes.some((s) => s.includes(scope))))
  const source = (s: string) => conns?.deviceSources.find((d) => d.source === s)
  const toggle = (d: Device) => setSelected(d === "none" ? ["none"] : selected.includes(d) ? selected.filter((x) => x !== d) : [...selected.filter((x) => x !== "none"), d])
  const back = encodeURIComponent("/connect")

  async function saveMe() {
    await tilo.request("PATCH", "/settings", {
      profile: { sex: me.sex || null, birth_date: me.birth_date || null, height_cm: me.height_cm ? Number(me.height_cm) : null },
    })
    if (me.weight) await tilo.addWeight(Number(me.weight.replace(",", ".")), undefined, localDate()).catch(() => {})
    setStep(2)
  }

  async function finish() {
    await tilo.request("PATCH", "/settings", { profile: { onboarding_done: true } })
    router.push("/")
  }

  const anyData = (conns?.deviceSources.length ?? 0) > 0 || has("strava")
  let n = 0

  return (
    <main className="main">
      <div className="wizard">
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24 }}>Conectá tus datos</h1>
          <p className="hint" style={{ margin: 0, fontSize: 14 }}>Dos minutos. Elegimos la mejor fuente para cada dato y si dos miden lo mismo, usamos la del reloj.</p>
        </div>

        {step === 1 && (
          <section className="section">
            <h3>Sobre vos</h3>
            <p>Con esto calculamos tu metabolismo basal. Sin estos datos el gasto calórico es una estimación.</p>
            <div className="row-inputs">
              <label className="field" htmlFor="w-sex"><span>Sexo</span>
                <select id="w-sex" className="select" value={me.sex} onChange={(e) => setMe({ ...me, sex: e.target.value })}>
                  <option value="">—</option><option value="male">Masculino</option><option value="female">Femenino</option>
                </select>
              </label>
              <label className="field" htmlFor="w-birth"><span>Fecha de nacimiento</span><input id="w-birth" className="input" type="date" value={me.birth_date} onChange={(e) => setMe({ ...me, birth_date: e.target.value })} /></label>
              <label className="field" htmlFor="w-h"><span>Altura (cm)</span><input id="w-h" className="input num" inputMode="numeric" value={me.height_cm} onChange={(e) => setMe({ ...me, height_cm: e.target.value })} /></label>
              <label className="field" htmlFor="w-w"><span>Peso hoy (kg)</span><input id="w-w" className="input num" inputMode="decimal" value={me.weight} onChange={(e) => setMe({ ...me, weight: e.target.value })} /></label>
            </div>
            <div><button className="btn leaf" onClick={saveMe}>Seguir</button></div>
          </section>
        )}

        {step === 2 && (
          <>
            <div className="devices" role="group" aria-label="¿Qué usás?">
              {DEVICES.map((d) => (
                <button key={d.id} className="dev" aria-pressed={selected.includes(d.id)} onClick={() => toggle(d.id)}>
                  <b>{d.name}</b>
                  <span>{d.hint}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {selected.includes("garmin") && (
                <Step n={++n} done={has("strava")} title="Garmin → Strava">
                  <p>En la app <b>Garmin Connect</b>: Más → Configuración → Aplicaciones conectadas → <b>Strava</b> → Conectar. Desde ahí cada actividad llega sola, con frecuencia cardíaca y calorías del reloj.</p>
                </Step>
              )}
              {selected.includes("watch") && (
                <Step n={++n} done={has("strava")} title="Tu reloj → Strava">
                  <p>Activá la sincronización con Strava en la app de tu reloj (Apple Watch: app Strava → Configuración → Apple Health; Coros, Polar, Suunto, Wahoo: desde su app). Tus entrenamientos llegan con frecuencia cardíaca y calorías.</p>
                </Step>
              )}
              {(selected.includes("strava") || selected.includes("garmin") || selected.includes("watch")) && (
                <Step n={++n} done={has("strava")} title="Conectar Strava" action={!has("strava") ? <a className="btn leaf sm" href={`/api/connect/strava?return=${back}`}>Conectar</a> : undefined}>
                  <p>Un click y aceptar. Importamos los últimos 30 días y después cada actividad nueva al instante.</p>
                </Step>
              )}
              {selected.includes("fitbit") && (
                <Step n={++n} done={has("google", "googlehealth")} title="Fitbit / Pixel Watch (Google Health)" action={!has("google", "googlehealth") ? <a className="btn leaf sm" href={`/api/connect/google?features=health&return=${back}`}>Conectar</a> : undefined}>
                  <p>Ya entraste con Google: solo aceptás los permisos de salud. Traemos pasos, distancia, energía activa y FC en reposo.</p>
                </Step>
              )}
              <Step n={++n} done={has("google", "gmail")} title="Gmail y Calendar (opcional)" action={!has("google", "gmail") ? <a className="btn ghost sm" href={`/api/connect/google?features=gmail,calendar&return=${back}`}>Conectar</a> : undefined}>
                <p>Tus reuniones en Today y un resumen diario de tu bandeja: personales vs. newsletters, cuáles esperan respuesta. Nunca guardamos el contenido de los mails.</p>
              </Step>
            </div>

            <div className={`verify${anyData ? "" : " wait"}`}>
              {anyData ? <CircleCheck aria-hidden="true" /> : <Loader2 aria-hidden="true" className="spin" />}
              <div style={{ flex: 1 }}>
                <b>{anyData ? "Recibimos tus datos" : "Esperando datos…"}</b>
                <div className="hint">
                  {anyData
                    ? [
                        ...(conns?.deviceSources ?? []).map((s) => `${s.device ?? s.source}: ${s.last_steps != null ? `${fmt(s.last_steps)} pasos` : "datos"} (${s.last_date})`),
                        ...(has("strava") ? ["Strava conectado"] : []),
                      ].join(" · ")
                    : "Esta pantalla se actualiza sola cuando llegan."}
                </div>
              </div>
              <button className="btn leaf" onClick={finish}>{anyData || selected.includes("none") ? "Listo" : "Terminar después"}</button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
