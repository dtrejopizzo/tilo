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

type SpeechRecognitionLike = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void }

export function QuickAdd({ date, day, compact = false, autoFocusKey = true }: { date: string; day: DayData | null; compact?: boolean; autoFocusKey?: boolean }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

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
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [autoFocusKey])

  async function save() {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const r = await tilo.quickAdd(text.trim(), date)
      toast(r.summary)
      setText("")
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

  return (
    <div className={`qa${compact ? "" : " desktop"}`}>
      <form
        className="qa-row"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Sparkles aria-hidden="true" />
        <label htmlFor={compact ? "qa-m" : "qa-d"} className="sr-only">Registrar algo</label>
        <input
          id={compact ? "qa-m" : "qa-d"}
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={compact ? "Registrá lo que sea…" : "Registrá lo que sea: 2 empanadas · 500 agua · banca 80x8x3 · D3 · tarea: … mañana"}
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
      {parsed && (
        <div className="qa-preview">
          <span className="chip kind">{KIND_LABEL[parsed.kind]}</span>
          {previewChips(parsed).map((c, i) => (
            <span key={i} className="chip">{c}</span>
          ))}
          <span className="spacer" />
          <button className="btn ghost sm" type="button" onClick={() => setText("")}>Borrar</button>
          <button className="btn leaf sm" type="button" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar ↵"}</button>
        </div>
      )}
    </div>
  )
}
