"use client"

import type { DayData } from "@tilo/core/apiTypes"
import { buildToday, type TodayView } from "@tilo/core/today"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEMO, localDate, tilo } from "./api"
import { supabaseBrowser } from "../supabase/browser"
import { useToast } from "./toast"

const cache = new Map<string, DayData>()
const inflight = new Map<string, Promise<DayData>>()
const listeners = new Set<(date: string) => void>()

// Tell every mounted useDay(date) to reload (e.g. after the quick-add bar saved something)
export function invalidateDay(date: string) {
  cache.delete(date)
  for (const l of listeners) l(date)
}

// One request per date even when several cards ask for the same day at once
function fetchDay(date: string): Promise<DayData> {
  let p = inflight.get(date)
  if (!p) {
    p = tilo.getDay(date).finally(() => inflight.delete(date))
    inflight.set(date, p)
  }
  return p
}

// Device data lands from webhooks and syncs while the page is open: listen to the tables they
// write (Realtime, filtered by RLS to this user) and reload the day that changed.
let liveStarted = false
function startLive() {
  if (liveStarted || DEMO || typeof window === "undefined") return
  liveStarted = true
  const supabase = supabaseBrowser()
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const touch = (date: string | undefined) => {
    const d = date ?? localDate()
    clearTimeout(pending.get(d))
    pending.set(d, setTimeout(() => invalidateDay(d), 800)) // a sync writes several rows at once
  }
  const channel = supabase.channel("tilo-day")
  for (const table of ["daily_metrics", "activities", "weight_logs"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload: { new?: { date?: string }; old?: { date?: string } }) => {
      touch(payload.new?.date ?? payload.old?.date)
    })
  }
  channel.subscribe()
}

export function useDay(date: string) {
  const [day, setDay] = useState<DayData | null>(() => cache.get(date) ?? null)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const d = await fetchDay(date)
      if (n !== seq.current) return
      cache.set(date, d)
      setDay(d)
      setError(null)
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [date])

  useEffect(() => {
    setDay(cache.get(date) ?? null)
    void load()
    startLive()
    const l = (d: string) => d === date && void load()
    listeners.add(l)
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => {
      listeners.delete(l)
      window.removeEventListener("focus", onFocus)
    }
  }, [date, load])

  // Optimistic update: apply locally, run the request, then reload; revert on failure
  const mutate = useCallback(
    async <T,>(apply: ((d: DayData) => DayData) | null, request: () => Promise<T>, success?: string | ((r: T) => string)) => {
      const before = cache.get(date) ?? null
      if (apply && before) {
        const next = apply(structuredClone(before))
        cache.set(date, next)
        setDay(next)
      }
      try {
        const r = await request()
        if (success) toast(typeof success === "function" ? success(r) : success)
        void load()
        return r
      } catch (e) {
        if (before) {
          cache.set(date, before)
          setDay(before)
        }
        toast(e instanceof Error ? e.message : String(e), { error: true })
        throw e
      }
    },
    [date, load, toast],
  )

  const view: TodayView | null = useMemo(() => (day ? buildToday(day) : null), [day])
  return { day, view, error, mutate, reload: load }
}
