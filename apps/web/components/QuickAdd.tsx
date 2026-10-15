"use client"

import type { DayData } from "@tilo/core/apiTypes"
import { parseQuickAdd, type QuickAddResult } from "@tilo/core/quickAdd"
import { Mic, Sparkles } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { tilo } from "@/lib/client/api"
import { useToast } from "@/lib/client/toast"
import { invalidateDay } from "@/lib/client/useDay"

const KIND_LABEL: Record<QuickAddResult["kind"], string> = {
  water: "Agua", weight: "Peso", caffeine: "Cafeína", task: "Tarea", sets: "Entrenamiento", cardio: "Cardio",
  supplement: "Suplemento", habit: "Hábito", checkin: "Check-in", meal: "Comida",
}

function previewChips(r: QuickAddResult): string[] {
  switch (r.kind) {
    case "water": return [`${r.ml} ml`]
    case "weight": return [`${r.kg} kg`, ...(r.bodyFatPct ? [`${r.bodyFatPct}% grasa`] : [])]
    case "caffeine": return [r.label, `${r.mg} mg`]
    case "task": return [r.title || "…", ...(r.dueDate ? [r.dueDate] : []), ...(r.priority ? [`prioridad ${r.priority === "high" ? "alta" : r.priority === "low" ? "baja" : "media"}`] : []), ...(r.project ? [`#${r.project}`] : [])]
    case "sets": {
      const reps = [...new Set(r.sets.map((s) => s.reps))]
      return [r.exercise.name_es, `${r.sets.length} × ${reps.length === 1 ? reps[0] : r.sets.map((s) => s.reps).join(",")} @ ${r.sets[0].weightKg || "BW"} kg`, ...(r.sets[0].rpe ? [`RPE ${r.sets[0].rpe}`] : [])]
    }
    case "cardio": return [r.exercise.name_es, ...(r.minutes ? [`${r.minutes} min`] : []), ...(r.distanceKm ? [`${r.distanceKm} km`] : [])]
    case "supplement": return [r.name, ...(r.dose ? [`${r.dose} ${r.unit === "iu" ? "UI" : r.unit ?? ""}`] : [])]
    case "habit": return [r.name, "✓"]
    case "checkin": return [...(r.energy ? [`energía ${r.energy}`] : []), ...(r.mood ? [`ánimo ${r.mood}`] : [])]
    case "meal": return [r.description, "calculamos calorías y macros con IA"]
  }
}

// What can be typed, shown while the field is empty. The person's own habits and supplements are added live.
function examples(day: DayData | null): { kind: string; samples: string[] }[] {
  return [
    { kind: "Agua", samples: ["500 agua", "2 vasos", "+250"] },
    { kind: "Comida", samples: ["2 empanadas y una manzana", "almuerzo: milanesa con puré", "café con leche"] },
    { kind: "Entrenamiento", samples: ["banca 80x8x3", "sentadilla 100x5x5 rpe 8", "dominadas 3x10"] },
    { kind: "Cardio", samples: ["corrí 5 km en 28 min", "bici 45 min", "caminé 40 min"] },
    { kind: "Tarea", samples: ["tarea: revisar PR mañana !alta #trabajo", "tarea: pagar monotributo el viernes"] },
    { kind: "Suplemento", samples: day?.supplements.length ? day.supplements.slice(0, 3).map((s) => s.name) : ["D3", "creatina 5 g", "magnesio"] },
    { kind: "Hábito", samples: day?.habits.length ? day.habits.slice(0, 3).map((h) => h.name) : ["leer 20 min", "meditar"] },
    { kind: "Peso y check-in", samples: ["peso 78.6", "78.6 kg 15%", "energía 4 ánimo 3"] },
  ]
}

type SpeechRecognitionLike = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void }

// mode "nav": lives in the top bar; the examples and the preview open as a dropdown under the field.
// mode "compact": the mobile dock. Default: a standalone card.
export function QuickAdd({ date, day, compact = false, autoFocusKey = true, mode }: { date: string; day: DayData | null; compact?: boolean; autoFocusKey?: boolean; mode?: "nav" }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const nav = mode === "nav"

  const parsed = useMemo(() => {
    if (!text.trim()) return null
    return parseQuickAdd(text, {
      today: date,
      habits: day?.habits.map((h) => ({ id: h.id, name: h.name })),
      supplements: day?.supplements.map((s) => ({ id: s.id, name: s.name, dose: s.dose, unit: s.unit })),
      projects: day?.projects.map((p) => p.name),
    })
  }, [text, date, day])

  useEffect(() => {
    if (!autoFocusKey) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (e.key === "/" && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        e.preventDefault()
        input.current?.focus()
      }
      if (e.key === "Escape" && nav) {
        setOpen(false)
        input.current?.blur()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [autoFocusKey, nav])

  // Close the dropdown when clicking anywhere else
  useEffect(() => {
    if (!nav || !open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [nav, open])

  async function save() {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const r = await tilo.quickAdd(text.trim(), date)
      toast(r.summary)
      setText("")
      setOpen(false)
      invalidateDay(date)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true })
    } finally {
      setBusy(false)
    }
  }

  // Detected after mount so server and client render the same markup
  const [SpeechRecognition, setSpeech] = useState<(new () => SpeechRecognitionLike) | undefined>()
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
    const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (ctor) setSpeech(() => ctor)
  }, [])

  function dictate() {
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.lang = "es-AR"
    rec.interimResults = true
    rec.onresult = (e) => setText(Array.from(e.results).map((r) => r[0].transcript).join(" "))
    rec.onend = () => setListening(false)
    setListening(true)
    rec.start()
  }

  const preview = parsed && (
    <div className="qa-preview">
      <span className="chip kind">{KIND_LABEL[parsed.kind]}</span>
      {previewChips(parsed).map((c, i) => (
        <span key={i} className="chip">{c}</span>
      ))}
      <span className="spacer" />
      <button className="btn ghost sm" type="button" onClick={() => setText("")}>Borrar</button>
      <button className="btn leaf sm" type="button" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar ↵"}</button>
    </div>
  )

  const id = nav ? "qa-n" : compact ? "qa-m" : "qa-d"
  return (
    <div ref={root} className={`qa${nav ? " nav" : compact ? "" : " desktop"}`}>
      <form
        className="qa-row"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Sparkles aria-hidden="true" />
        <label htmlFor={id} className="sr-only">Registrar algo</label>
        <input
          id={id}
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={nav || compact ? "Registrá lo que sea…" : "Registrá lo que sea: 2 empanadas · 500 agua · banca 80x8x3 · D3 · tarea: … mañana"}
          autoComplete="off"
          enterKeyHint="done"
          disabled={busy}
        />
        {SpeechRecognition && (
          <button type="button" className="iconbtn" aria-label={listening ? "Escuchando" : "Dictar"} onClick={dictate} style={listening ? { color: "var(--danger)" } : undefined}>
            <Mic />
          </button>
        )}
        {!compact && <span className="kbd" aria-hidden="true">/</span>}
      </form>
      {nav ? (
        open && (
          <div className="qa-drop">
            {parsed ? (
              preview
            ) : text.trim() ? (
              <div className="qa-hint">No lo entendí todavía. Si es comida, escribila como la comerías; si es una tarea, empezá con "tarea:".</div>
            ) : (
              <div className="qa-examples">
                {examples(day).map((g) => (
                  <div key={g.kind} className="qa-group">
                    <span className="qa-kind">{g.kind}</span>
                    {g.samples.map((s) => (
                      <button key={s} type="button" className="chip" onClick={() => { setText(s); input.current?.focus() }}>{s}</button>
                    ))}
                  </div>
                ))}
                <div className="qa-hint">Enter guarda. Lo que no sea agua, series, peso, suplemento, hábito o tarea se toma como comida y la IA calcula calorías y macros.</div>
              </div>
            )}
          </div>
        )
      ) : (
        preview
      )}
    </div>
  )
}
