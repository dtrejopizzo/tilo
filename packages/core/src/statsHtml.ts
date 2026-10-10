import type { Achievement } from "./achievements"
import type { MonthStats, StatsDay } from "./stats"

// Renders the stats dashboard as an HTML fragment rooted at .tilo-stats.
// Colors come from VSCode theme variables, so it follows the user's theme.
// No vscode imports, so the same code can run in a browser preview.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const fmtInt = (n: number) => Math.round(n).toLocaleString("es-AR")
const fmtLitres = (ml: number) => `${(ml / 1000).toFixed(1).replace(/\.0$/, "")}L`
const fmtPct = (r: number) => `${Math.round(r * 100)}%`
const dayLabel = (d: StatsDay) =>
  new Date(`${d.date}T00:00:00Z`).toLocaleString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "")

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow
  return 10 * pow
}

const ICONS = {
  // Tilo's mark: an Australian Shepherd (24×24, stroke)
  dog: '<path d="M8.6 4.5C6.2 3.3 3.3 3.9 2.5 6.3c-.7 2.2-.2 4.6 1.3 6.6"/><path d="M15.4 4.5c2.4-1.2 5.3-.6 6.1 1.8.7 2.2.2 4.6-1.3 6.6"/><path d="M5.2 10.2c0 5.4 3 9.8 6.8 10.4 3.8-.6 6.8-5 6.8-10.4 0-3.6-3-6.2-6.8-6.2s-6.8 2.6-6.8 6.2z"/><path d="M9 14.6c.8 1.6 1.8 2.3 3 2.3s2.2-.7 3-2.3"/><path d="M11 16.8c0 1.3.5 2.1 1 2.1s1-.8 1-2.1" fill="currentColor"/><ellipse cx="12" cy="12.9" rx="1.5" ry="1.1" fill="currentColor"/><circle cx="8.6" cy="10.3" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.4" cy="10.3" r="1.05" fill="currentColor" stroke="none"/>',
  leaf: '<path d="M12 21c-4.5-2.2-7-5.8-7-10 0-3.6 3-6.5 7-8 4 1.5 7 4.4 7 8 0 4.2-2.5 7.8-7 10z"/><path d="M12 21V8"/><path d="M12 13l-3-2.5M12 11l3-2.5"/>',
  prev: '<path d="M10 3 5 8l5 5"/>',
  next: '<path d="m6 3 5 5-5 5"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M12 2v3h-3"/>',
}
const icon = (name: keyof typeof ICONS, vb = 16) =>
  `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

// ---------- KPI tiles ----------

function kpi(label: string, value: string, sub: string, tone = ""): string {
  return `<div class="kpi ${tone}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`
}

function kpis(s: MonthStats): string {
  const k = s.kpis
  const tiles = [
    kpi(
      "Hábitos",
      k.habitRate === null ? "—" : fmtPct(k.habitRate),
      `${k.perfectDays} ${k.perfectDays === 1 ? "día perfecto" : "días perfectos"}`,
      "green",
    ),
    s.isCurrentMonth
      ? kpi("Racha actual", `${k.streak.current ?? 0}<small>d</small>`, `mejor: ${k.streak.best}d · comodines ${k.streak.freezesUsed}/${k.streak.freezesPerMonth}`, "green")
      : kpi("Mejor racha", `${k.streak.best}<small>d</small>`, "todos los hábitos diarios", "green"),
    kpi(
      "Tareas hechas",
      fmtInt(k.tasks.total),
      k.tasks.busiest ? `día récord: ${dayLabel(k.tasks.busiest)} (${k.tasks.busiest.tasksCompleted})` : "ninguna todavía",
      "purple",
    ),
    kpi(
      "Agua / día",
      fmtLitres(k.water.avg),
      `${k.water.daysOnTarget}/${s.elapsed.length} días ≥ ${fmtLitres(s.targets.water)}`,
      "blue",
    ),
    kpi(
      "Calorías / día",
      k.calories.avg === null ? "—" : fmtInt(k.calories.avg),
      k.calories.avg === null
        ? "sin comidas registradas"
        : `objetivo ${fmtInt(s.targets.calories)} · ${k.calories.daysOnTarget}/${k.calories.loggedDays} en objetivo`,
      "orange",
    ),
    kpi("Días activos", String(k.sport.activeDays), `${fmtInt(k.sport.minutes)} min de deporte`, "teal"),
  ]
  if (k.steps) {
    tiles.push(kpi("Pasos / día", fmtInt(k.steps.avg), `${k.steps.daysOnTarget}/${k.steps.days} días ≥ ${fmtInt(s.targets.steps ?? 10000)}`, "blue"))
  }
  if (k.sleep) {
    const mins = Math.round(k.sleep.avg)
    tiles.push(kpi("Sueño / noche", `${Math.floor(mins / 60)}<small>h</small>${String(mins % 60).padStart(2, "0")}`, `${k.sleep.daysOnTarget}/${k.sleep.days} noches en objetivo`, "purple"))
  }
  if (k.balance) {
    const b = Math.round(k.balance.avg)
    tiles.push(kpi("Balance / día", `${b > 0 ? "+" : "−"}${fmtInt(Math.abs(b))}<small>kcal</small>`, `${b < 0 ? "déficit" : "superávit"} · ${k.balance.days} días con comidas`, b < 0 ? "green" : "orange"))
  }
  if (k.weight) {
    const change = k.weight.change
    tiles.push(
      kpi(
        "Peso",
        `${k.weight.latest.toFixed(1)}<small>kg</small>`,
        change === null ? "1 registro este mes" : `${change > 0 ? "+" : ""}${change.toFixed(1)} kg este mes`,
      ),
    )
  }
  return `<section class="kpis">${tiles.join("")}</section>`
}

// ---------- Habit calendar (contribution graph) ----------

function habitLevel(d: StatsDay, total: number): number {
  if (total === 0 || d.habitsDone === 0) return 0
  const r = d.habitsDone / total
  return r >= 1 ? 4 : r >= 0.67 ? 3 : r >= 0.34 ? 2 : 1
}

function habitCalendar(s: MonthStats): string {
  const cell = 18
  const gap = 4
  const left = 30
  const top = 4
  const offset = s.days[0]?.weekday ?? 0
  const cols = Math.ceil((offset + s.days.length) / 7)
  const w = left + cols * (cell + gap)
  const h = top + 7 * (cell + gap)
  const rows = ["Lun", "", "Mié", "", "Vie", "", "Dom"]
    .map((l, i) => (l ? `<text x="0" y="${top + i * (cell + gap) + cell - 5}" class="axis">${l}</text>` : ""))
    .join("")
  const cells = s.days
    .map((d) => {
      const i = offset + d.day - 1
      const x = left + Math.floor(i / 7) * (cell + gap)
      const y = top + (i % 7) * (cell + gap)
      const frozen = s.frozen.has(d.date)
      const level = d.future ? "future" : `l${habitLevel(d, s.dailyHabitCount)}${frozen ? " frozen" : ""}`
      const tip = d.future
        ? dayLabel(d)
        : `${dayLabel(d)}: ${d.habitsDone}/${s.dailyHabitCount} hábitos${frozen ? " · salvado con un comodín" : ""}`
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" class="cell ${level}${d.isToday ? " today" : ""}${d.future ? "" : " day"}"${d.future ? "" : ` data-date="${d.date}"`}><title>${tip}</title></rect>`
    })
    .join("")
  return `<svg class="calendar" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Hábitos cumplidos por día">${rows}${cells}</svg>`
}

function habitRows(s: MonthStats): string {
  if (s.habits.length === 0) return `<p class="empty">Todavía no tenés hábitos. Agregalos en Settings.</p>`
  const size = 11
  const gap = 3
  const w = s.days.length * (size + gap)
  return s.habits
    .map((h) => {
      const squares = s.days
        .map((d, i) => {
          const cls = d.future ? "future" : h.done.has(d.date) ? "l4" : "l0"
          return `<rect x="${i * (size + gap)}" y="0" width="${size}" height="${size}" rx="2" class="cell ${cls}"><title>${esc(h.name)} · ${dayLabel(d)}${h.done.has(d.date) ? " ✓" : ""}</title></rect>`
        })
        .join("")
      const denom = h.frequency === "Weekly" ? "" : `/${s.elapsed.length}`
      return `<div class="habit"><span class="habit-name" title="${esc(h.name)}">${esc(h.name)}${h.frequency === "Weekly" ? ' <span class="pill">semanal</span>' : ""}</span>
        <svg viewBox="0 0 ${w} ${size}" width="${w}" height="${size}" class="habit-strip" aria-hidden="true">${squares}</svg>
        <span class="habit-count">${h.count}${denom}</span></div>`
    })
    .join("")
}

function legend(): string {
  const box = (cls: string) => `<svg width="11" height="11" aria-hidden="true"><rect width="11" height="11" rx="2" class="cell ${cls}"/></svg>`
  return `<div class="legend">Menos ${["l0", "l1", "l2", "l3", "l4"].map(box).join("")} Más <span style="margin-left:10px">${box("l0 frozen")} comodín</span></div>`
}

// ---------- Bar charts ----------

interface BarOptions {
  days: StatsDay[]
  value: (d: StatsDay) => number
  barClass: (d: StatsDay) => string
  tip: (d: StatsDay) => string
  axis: (v: number) => string
  target?: number
  targetLabel?: string
}

function barChart(o: BarOptions): string {
  const W = 640
  const H = 170
  const pl = 44
  const pr = 8
  const pt = 12
  const pb = 22
  const ih = H - pt - pb
  const step = (W - pl - pr) / o.days.length
  const bw = Math.max(3, step * 0.66)
  const max = niceCeil(Math.max(...o.days.map(o.value), o.target ? o.target * 1.08 : 0, 1))
  const y = (v: number) => pt + ih - (v / max) * ih

  const grid = [0, max / 2, max]
    .map(
      (v) =>
        `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${o.axis(v)}</text>`,
    )
    .join("")
  const bars = o.days
    .map((d, i) => {
      const x = pl + i * step + (step - bw) / 2
      if (d.future) return `<rect x="${x}" y="${pt + ih - 1}" width="${bw}" height="1" class="bar-future"/>`
      const v = o.value(d)
      const h = Math.max(v > 0 ? 2 : 1, (v / max) * ih)
      const cls = v > 0 ? o.barClass(d) : "bar-zero"
      return `<rect x="${x}" y="${pt + ih - h}" width="${bw}" height="${h}" rx="1.5" class="${cls}${d.isToday ? " today" : ""} day" data-date="${d.date}"><title>${o.tip(d)}</title></rect>`
    })
    .join("")
  const labels = o.days
    .filter((d) => d.day === 1 || d.day % 7 === 1)
    .map((d) => {
      const x = pl + (d.day - 1) * step + step / 2
      return `<text x="${x}" y="${H - 6}" class="axis" text-anchor="middle">${d.day === 1 ? dayLabel(d) : d.day}</text>`
    })
    .join("")
  const target = o.target
    ? `<line x1="${pl}" x2="${W - pr}" y1="${y(o.target)}" y2="${y(o.target)}" class="target"/><text x="${W - pr}" y="${y(o.target) - 4}" class="axis target-label" text-anchor="end">${o.targetLabel ?? "objetivo"}</text>`
    : ""
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${grid}${bars}${target}${labels}</svg>`
}

function divergingChart(days: StatsDay[], value: (d: StatsDay) => number | null, tip: (d: StatsDay, v: number) => string): string {
  const W = 640
  const H = 170
  const pl = 44
  const pr = 8
  const pt = 10
  const pb = 22
  const half = (H - pt - pb) / 2
  const mid = pt + half
  const step = (W - pl - pr) / days.length
  const bw = Math.max(3, step * 0.66)
  const vals = days.map((d) => (d.future ? null : value(d)))
  const max = niceCeil(Math.max(250, ...vals.map((v) => Math.abs(v ?? 0))))
  const grid = [-max, 0, max]
    .map((v) => {
      const y = mid - (v / max) * half
      return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="${v === 0 ? "zero-line" : "grid"}"/><text x="${pl - 6}" y="${y + 4}" class="axis" text-anchor="end">${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtInt(Math.abs(v))}</text>`
    })
    .join("")
  const bars = days
    .map((d, i) => {
      const v = vals[i]
      if (v == null) return ""
      const x = pl + i * step + (step - bw) / 2
      const h = Math.max(1, (Math.min(Math.abs(v), max) / max) * half)
      return `<rect x="${x}" y="${v >= 0 ? mid - h : mid}" width="${bw}" height="${h}" rx="1.5" class="${v < 0 ? "bar-green" : "bar-orange"}${d.isToday ? " today" : ""} day" data-date="${d.date}"><title>${tip(d, v)}</title></rect>`
    })
    .join("")
  const labels = days
    .filter((d) => d.day === 1 || d.day % 7 === 1)
    .map((d) => `<text x="${pl + (d.day - 1) * step + step / 2}" y="${H - 6}" class="axis" text-anchor="middle">${d.day === 1 ? dayLabel(d) : d.day}</text>`)
    .join("")
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${grid}${bars}${labels}</svg>`
}

function muscleBars(s: MonthStats): string {
  const target = s.targets.weeklySets ?? 10
  const max = Math.max(target * 1.5, ...s.muscles.map((m) => m.perWeek))
  const W = 640
  const rowH = 26
  const left = 96
  const width = W - left - 70
  const H = s.muscles.length * rowH + 18
  const rows = s.muscles
    .map((m, i) => {
      const y = i * rowH + 4
      const w = (m.perWeek / max) * width
      return `<text x="0" y="${y + 13}" class="axis label">${esc(MUSCLE_ES[m.muscle] ?? m.muscle)}</text>` +
        `<rect x="${left}" y="${y}" width="${width}" height="16" rx="3" class="track"/>` +
        `<rect x="${left}" y="${y}" width="${w}" height="16" rx="3" class="${m.perWeek >= target ? "bar-green" : "bar-green dim"}"><title>${m.sets} series este mes · ${m.perWeek}/semana</title></rect>` +
        `<text x="${left + w + 6}" y="${y + 12}" class="axis">${m.perWeek}/sem</text>`
    })
    .join("")
  const tx = left + (target / max) * width
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${rows}<line x1="${tx}" x2="${tx}" y1="0" y2="${H - 14}" class="target"/><text x="${tx}" y="${H - 2}" class="axis target-label" text-anchor="middle">${target} series/sem</text></svg>`
}

const MUSCLE_ES: Record<string, string> = {
  chest: "Pecho", back: "Espalda", shoulders: "Hombros", biceps: "Bíceps", triceps: "Tríceps", forearms: "Antebrazos",
  quads: "Cuádriceps", hamstrings: "Isquios", glutes: "Glúteos", calves: "Gemelos", core: "Core", full_body: "Cuerpo completo", cardio: "Cardio",
}

function liftsTable(s: MonthStats): string {
  return `<div class="lifts">${s.lifts
    .map(
      (l) => `<div class="lift"><span class="lift-name">${esc(l.name)}</span><span class="lift-set">${l.weightKg} × ${l.reps}</span><span class="lift-e1rm">${l.e1rm.toFixed(1)} kg</span></div>`,
    )
    .join("")}</div><div class="key">1RM estimado (Epley) con la mejor serie del mes</div>`
}

const ACH_ICONS: Record<Achievement["icon"], string> = {
  flame: '<path d="M8 14.5c-2.8 0-4.5-1.9-4.5-4.3C3.5 7 6.5 5.5 6.5 1.5 9 3 9.5 5 9.2 6.7 10 6 10.5 5.2 10.6 4.2c1.3 1.3 1.9 3 1.9 4.8 0 3.3-1.7 5.5-4.5 5.5z"/>',
  drop: '<path d="M8 1.8C8 1.8 3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 1.8 8 1.8z"/>',
  steps: '<path d="M5 2.5c1.4 0 2 1.6 2 3.5s-.8 3-2 3-2-1.1-2-3 .6-3.5 2-3.5zM4 10.5h2.5l-.3 2.3c-.2 1-2 1-2-.2zM11 5.5c1.4 0 2 1.6 2 3.5s-.8 3-2 3-2-1.1-2-3 .6-3.5 2-3.5z"/>',
  dumbbell: '<path d="M1.5 8h13M3.5 5v6M5.5 4v8M10.5 4v8M12.5 5v6"/>',
  trophy: '<path d="M5 2h6v4a3 3 0 0 1-6 0zM5 3H2.5c0 2 1 3 2.5 3M11 3h2.5c0 2-1 3-2.5 3M8 9v3M5.5 14h5"/>',
  check: '<path d="m3 8.5 3 3 7-7"/>',
  brain: '<path d="M6 2.5a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 3 10a2.5 2.5 0 0 0 3 3.5V2.5zM10 2.5A2.5 2.5 0 0 1 12.5 5 2.5 2.5 0 0 1 13 10a2.5 2.5 0 0 1-3 3.5V2.5z"/>',
  moon: '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/>',
  mail: '<path d="M2 4h12v8H2zM2 4l6 5 6-5"/>',
  leaf: '<path d="M8 14c-3-1.5-4.5-4-4.5-6.8C3.5 4.8 5.5 2.8 8 2c2.5.8 4.5 2.8 4.5 5.2 0 2.8-1.5 5.3-4.5 6.8zM8 14V6"/>',
}

function achievementsCard(list: Achievement[]): string {
  const unlocked = list.filter((a) => a.unlockedOn).length
  const fmtVal = (a: Achievement) => (a.target >= 1000 ? `${fmtInt(a.value / (a.id === "focus-50h" ? 60 : 1))}/${fmtInt(a.target / (a.id === "focus-50h" ? 60 : 1))}` : `${a.value}/${a.target}`)
  const items = list
    .map((a) => {
      const date = a.unlockedOn ? new Date(`${a.unlockedOn}T00:00:00Z`).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""
      return `<div class="ach${a.unlockedOn ? " on" : ""}" title="${esc(a.description)}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ACH_ICONS[a.icon]}</svg>
        <div class="ach-text"><b>${esc(a.title)}</b><span>${a.unlockedOn ? `logrado el ${date}` : esc(a.description)}</span>
        ${a.unlockedOn ? "" : `<div class="ach-bar"><i style="width:${Math.round((a.value / a.target) * 100)}%"></i></div><span class="ach-val">${fmtVal(a)}</span>`}</div>
      </div>`
    })
    .join("")
  return card("Logros", `${unlocked} de ${list.length} desbloqueados`, `<div class="achs">${items}</div>`, "wide")
}

function card(title: string, summary: string, body: string, extra = ""): string {
  return `<section class="card ${extra}"><header><h2>${title}</h2><span class="summary">${summary}</span></header>${body}</section>`
}

// ---------- Page ----------

export function renderStatsBody(s: MonthStats, opts: { updatedAt?: string; loading?: boolean; achievements?: Achievement[] } = {}): string {
  const k = s.kpis
  const calTarget = s.targets.calories
  const header = `<header class="top">
    <div class="brand">${icon("dog", 24)}<span>Tilo Stats</span></div>
    <div class="nav">
      <button class="btn icon" data-action="prev" title="Mes anterior" aria-label="Mes anterior">${icon("prev")}</button>
      <span class="month">${s.label}</span>
      <button class="btn icon" data-action="next" title="Mes siguiente" aria-label="Mes siguiente" ${s.isCurrentMonth ? "disabled" : ""}>${icon("next")}</button>
      ${s.isCurrentMonth ? "" : `<button class="btn" data-action="today">Este mes</button>`}
      <button class="btn icon" data-action="refresh" title="Actualizar" aria-label="Actualizar">${icon("refresh")}</button>
    </div>
  </header>`

  const habits = card(
    "Hábitos",
    k.habitRate === null ? "sin hábitos diarios" : `${fmtPct(k.habitRate)} de los hábitos diarios cumplidos`,
    `<div class="habits-grid"><div class="cal-wrap">${habitCalendar(s)}${legend()}</div><div class="habit-list">${habitRows(s)}</div></div>`,
    "wide",
  )
  const tasks = card(
    "Tareas completadas",
    `${fmtInt(k.tasks.total)} este mes`,
    barChart({
      days: s.days,
      value: (d) => d.tasksCompleted,
      barClass: () => "bar-purple",
      tip: (d) => `${dayLabel(d)}: ${d.tasksCompleted} ${d.tasksCompleted === 1 ? "tarea" : "tareas"}`,
      axis: (v) => (Number.isInteger(v) ? String(v) : ""),
    }),
  )
  const water = card(
    "Agua",
    `promedio ${fmtLitres(k.water.avg)} / ${fmtLitres(s.targets.water)}`,
    barChart({
      days: s.days,
      value: (d) => d.water,
      barClass: (d) => (d.water >= s.targets.water ? "bar-blue" : "bar-blue dim"),
      tip: (d) => `${dayLabel(d)}: ${fmtInt(d.water)} ml`,
      axis: fmtLitres,
      target: s.targets.water,
    }),
  )
  const calories = card(
    "Calorías",
    k.calories.avg === null ? "sin comidas registradas" : `promedio ${fmtInt(k.calories.avg)} / ${fmtInt(calTarget)} kcal`,
    barChart({
      days: s.days,
      value: (d) => d.calories,
      barClass: (d) => (d.calories > calTarget * 1.1 ? "bar-orange" : d.calories < calTarget * 0.9 ? "bar-orange dim" : "bar-green"),
      tip: (d) => `${dayLabel(d)}: ${fmtInt(d.calories)} kcal (${d.mealsLogged} comidas)`,
      axis: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(v)),
      target: calTarget,
    }) +
      `<div class="key"><span><i class="bar-green"></i>dentro de ±10%</span><span><i class="bar-orange"></i>pasado</span><span><i class="bar-orange dim"></i>por debajo</span></div>`,
  )
  const sport = card(
    "Actividad",
    `${fmtInt(k.sport.minutes)} min · ${k.sport.activeDays} días activos`,
    barChart({
      days: s.days,
      value: (d) => d.sportMinutes,
      barClass: () => "bar-teal",
      tip: (d) => `${dayLabel(d)}: ${d.sportMinutes} min`,
      axis: (v) => (v ? `${v}m` : "0"),
    }),
  )

  const extra: string[] = []
  if (k.sleep) {
    const target = s.targets.sleepMin ?? 450
    extra.push(card(
      "Sueño",
      `promedio ${Math.floor(Math.round(k.sleep.avg) / 60)} h ${String(Math.round(k.sleep.avg) % 60).padStart(2, "0")} min · objetivo ${Math.floor(target / 60)} h ${String(target % 60).padStart(2, "0")}`,
      barChart({
        days: s.days,
        value: (d) => d.sleepMin ?? 0,
        barClass: (d) => ((d.sleepMin ?? 0) >= target ? "bar-purple" : "bar-purple dim"),
        tip: (d) => `${dayLabel(d)}: ${Math.floor((d.sleepMin ?? 0) / 60)} h ${String((d.sleepMin ?? 0) % 60).padStart(2, "0")} min`,
        axis: (v) => (v ? `${Math.round(v / 60)}h` : "0"),
        target,
      }),
    ))
  }
  if (k.balance) {
    extra.push(card(
      "Balance energético",
      `promedio ${Math.round(k.balance.avg) > 0 ? "+" : "−"}${fmtInt(Math.abs(k.balance.avg))} kcal/día · verde = déficit`,
      divergingChart(s.days, (d) => (d.kcalOut != null && d.mealsLogged > 0 ? d.calories - d.kcalOut : null), (d, v) => `${dayLabel(d)}: ${v > 0 ? "+" : ""}${fmtInt(v)} kcal (comiste ${fmtInt(d.calories)} · gastaste ${fmtInt(d.kcalOut ?? 0)})`),
    ))
  }
  if (k.steps) {
    const target = s.targets.steps ?? 10000
    extra.push(card(
      "Pasos",
      `promedio ${fmtInt(k.steps.avg)} · ${k.steps.daysOnTarget} días ≥ ${fmtInt(target)}`,
      barChart({
        days: s.days,
        value: (d) => d.steps ?? 0,
        barClass: (d) => ((d.steps ?? 0) >= target ? "bar-blue" : "bar-blue dim"),
        tip: (d) => `${dayLabel(d)}: ${fmtInt(d.steps ?? 0)} pasos`,
        axis: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
        target,
      }),
    ))
  }
  if (s.muscles.length) {
    extra.push(card("Volumen por músculo", `${fmtInt(k.training?.sets ?? 0)} series · ${fmtInt(k.training?.volumeKg ?? 0)} kg · ${k.training?.workoutDays ?? 0} días`, muscleBars(s)))
  }
  if (s.lifts.length) extra.push(card("Récords", "mejor 1RM estimado del mes", liftsTable(s)))
  if (k.inbox) {
    extra.push(card(
      "Bandeja de entrada",
      `${fmtInt(k.inbox.latest)} mails (${k.inbox.change > 0 ? "+" : ""}${k.inbox.change} este mes)${k.inbox.personalShare != null ? ` · ${fmtPct(k.inbox.personalShare)} personales` : ""}`,
      barChart({
        days: s.days,
        value: (d) => d.inboxTotal ?? 0,
        barClass: (d) => (d.inboxTotal != null && d.day > 1 && (s.days[d.day - 2]?.inboxTotal ?? d.inboxTotal) < d.inboxTotal ? "bar-orange" : "bar-blue"),
        tip: (d) => `${dayLabel(d)}: ${d.inboxTotal ?? "–"} en la bandeja · ${d.personalMail ?? 0} personales · ${d.newsletters ?? 0} newsletters`,
        axis: (v) => String(Math.round(v)),
      }) + `<div class="key"><span><i class="bar-orange"></i>creció vs. el día anterior</span><span><i class="bar-blue"></i>igual o menor</span></div>`,
    ))
  }
  if (k.focus) {
    extra.push(card(
      "Foco",
      `${Math.round(k.focus.minutes / 60)} h en ${k.focus.days} días`,
      barChart({ days: s.days, value: (d) => d.focusMin ?? 0, barClass: () => "bar-purple", tip: (d) => `${dayLabel(d)}: ${d.focusMin ?? 0} min de foco`, axis: (v) => (v ? `${Math.round(v / 60)}h` : "0") }),
    ))
  }

  return `<div class="tilo-stats${opts.loading ? " loading" : ""}">
    ${header}
    ${kpis(s)}
    ${habits}
    ${opts.achievements?.length ? achievementsCard(opts.achievements) : ""}
    <div class="charts">${tasks}${water}${calories}${sport}${extra.join("")}</div>
    <footer class="foot">${opts.updatedAt ? `Actualizado ${esc(opts.updatedAt)} · ` : ""}Los días van en tu hora local. Pasá el mouse para ver el detalle y hacé click en un día para editarlo.</footer>
  </div>`
}

export function renderStatsMessage(title: string, detail: string, action?: { label: string; action: string }): string {
  return `<div class="tilo-stats"><div class="message">${icon("dog", 24)}<h2>${esc(title)}</h2><p>${esc(detail)}</p>${
    action ? `<button class="btn primary" data-action="${action.action}">${esc(action.label)}</button>` : ""
  }</div></div>`
}

export const STATS_CSS = `
.tilo-stats {
  --tl-fg: var(--vscode-foreground, #cccccc);
  --tl-muted: var(--vscode-descriptionForeground, #9d9d9d);
  --tl-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.3)));
  --tl-green: var(--vscode-charts-green, #3fb950);
  --tl-blue: var(--vscode-charts-blue, #3794ff);
  --tl-orange: var(--vscode-charts-orange, #d18616);
  --tl-purple: var(--vscode-charts-purple, #b180d7);
  --tl-teal: var(--vscode-terminal-ansiCyan, #29b8db);
  --tl-empty: color-mix(in srgb, var(--tl-fg) 9%, transparent);
  color: var(--tl-fg);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  max-width: 1120px;
  margin: 0 auto;
  padding: 20px 24px 32px;
  display: grid;
  gap: 16px;
  font-variant-numeric: tabular-nums;
  transition: opacity .15s;
}
.tilo-stats.loading { opacity: .5; pointer-events: none; }
.tilo-stats * { box-sizing: border-box; }
.tilo-stats .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.tilo-stats .brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 600; }
.tilo-stats .brand svg { width: 24px; height: 24px; color: var(--tl-green); }
.tilo-stats .nav { display: flex; align-items: center; gap: 6px; }
.tilo-stats .month { font-weight: 600; min-width: 128px; text-align: center; }
.tilo-stats .btn { font: inherit; color: var(--vscode-button-secondaryForeground, var(--tl-fg)); background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.2)); border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.tilo-stats .btn:hover:not([disabled]) { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.3)); }
.tilo-stats .btn[disabled] { opacity: .4; cursor: default; }
.tilo-stats .btn.icon { width: 26px; height: 26px; padding: 0; }
.tilo-stats .btn.primary { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0078d4); }
.tilo-stats .btn svg { width: 16px; height: 16px; }
.tilo-stats .btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #2b79d4); outline-offset: 1px; }

.tilo-stats .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); border: 1px solid var(--tl-border); border-radius: 6px; overflow: hidden; }
.tilo-stats .kpi { padding: 12px 14px; border-right: 1px solid var(--tl-border); position: relative; min-width: 0; }
.tilo-stats .kpi:last-child { border-right: 0; }
.tilo-stats .kpi::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--tone, transparent); }
.tilo-stats .kpi.green { --tone: var(--tl-green); } .tilo-stats .kpi.blue { --tone: var(--tl-blue); }
.tilo-stats .kpi.orange { --tone: var(--tl-orange); } .tilo-stats .kpi.purple { --tone: var(--tl-purple); }
.tilo-stats .kpi.teal { --tone: var(--tl-teal); }
.tilo-stats .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--tl-muted); }
.tilo-stats .kpi-value { font-size: 26px; font-weight: 600; line-height: 1.25; margin-top: 4px; }
.tilo-stats .kpi-value small { font-size: 14px; font-weight: 500; color: var(--tl-muted); margin-left: 2px; }
.tilo-stats .kpi-sub { font-size: 12px; color: var(--tl-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tilo-stats .card { border: 1px solid var(--tl-border); border-radius: 6px; padding: 14px 16px; min-width: 0; }
.tilo-stats .card header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.tilo-stats .card h2 { font-size: 13px; font-weight: 600; margin: 0; }
.tilo-stats .summary { font-size: 12px; color: var(--tl-muted); }
.tilo-stats .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
.tilo-stats .chart { width: 100%; height: auto; display: block; }

.tilo-stats .habits-grid { display: flex; gap: 28px; align-items: flex-start; flex-wrap: wrap; }
.tilo-stats .cal-wrap { display: grid; gap: 8px; flex: none; }
.tilo-stats .habit-list { flex: 1; min-width: 280px; display: grid; gap: 7px; overflow-x: auto; }
.tilo-stats .habit { display: grid; grid-template-columns: minmax(110px, 170px) auto 52px; align-items: center; gap: 12px; }
.tilo-stats .habit-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tilo-stats .habit-count { color: var(--tl-muted); text-align: right; font-size: 12px; }
.tilo-stats .pill { font-size: 10px; color: var(--tl-muted); border: 1px solid var(--tl-border); border-radius: 8px; padding: 0 5px; margin-left: 4px; }
.tilo-stats .legend { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--tl-muted); justify-content: flex-end; }
.tilo-stats .legend svg { display: block; }

.tilo-stats .cell.l0 { fill: var(--tl-empty); }
.tilo-stats .cell.l1 { fill: color-mix(in srgb, var(--tl-green) 30%, transparent); }
.tilo-stats .cell.l2 { fill: color-mix(in srgb, var(--tl-green) 55%, transparent); }
.tilo-stats .cell.l3 { fill: color-mix(in srgb, var(--tl-green) 78%, transparent); }
.tilo-stats .cell.l4 { fill: var(--tl-green); }
.tilo-stats .cell.future { fill: none; stroke: var(--tl-empty); stroke-width: 1; }
.tilo-stats .cell.today, .tilo-stats .chart .today { stroke: var(--tl-fg); stroke-width: 1.5; }

.tilo-stats .axis { font-size: 10px; fill: var(--tl-muted); font-family: inherit; }
.tilo-stats .grid { stroke: var(--tl-border); stroke-width: 1; }
.tilo-stats .target { stroke: var(--tl-fg); stroke-opacity: .55; stroke-dasharray: 4 3; stroke-width: 1; }
.tilo-stats .target-label { fill: var(--tl-fg); opacity: .7; }
.tilo-stats .bar-purple { fill: var(--tl-purple); } .tilo-stats .bar-blue { fill: var(--tl-blue); }
.tilo-stats .bar-orange { fill: var(--tl-orange); } .tilo-stats .bar-green { fill: var(--tl-green); }
.tilo-stats .bar-teal { fill: var(--tl-teal); }
.tilo-stats .dim { fill-opacity: .45; }
.tilo-stats .bar-zero { fill: var(--tl-empty); }
.tilo-stats .bar-future { fill: var(--tl-empty); }
.tilo-stats .key { display: flex; gap: 14px; font-size: 11px; color: var(--tl-muted); margin-top: 6px; }
.tilo-stats .key i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: currentColor; }
.tilo-stats .key i.bar-green { color: var(--tl-green); } .tilo-stats .key i.bar-orange { color: var(--tl-orange); }
.tilo-stats .key i.dim { opacity: .45; }
.tilo-stats .empty { color: var(--tl-muted); margin: 0; }
.tilo-stats .day { cursor: pointer; }
.tilo-stats .cell.frozen { stroke: var(--tl-blue); stroke-width: 1.5; stroke-dasharray: 2 2; }
.tilo-stats .achs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.tilo-stats .ach { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 6px; border: 1px solid var(--tl-border); opacity: .75; }
.tilo-stats .ach.on { opacity: 1; border-color: color-mix(in srgb, var(--tl-orange) 50%, transparent); background: color-mix(in srgb, var(--tl-orange) 8%, transparent); }
.tilo-stats .ach svg { width: 22px; height: 22px; flex: none; color: var(--tl-muted); }
.tilo-stats .ach.on svg { color: var(--tl-orange); }
.tilo-stats .ach-text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.tilo-stats .ach-text span { font-size: 12px; color: var(--tl-muted); }
.tilo-stats .ach-bar { height: 4px; border-radius: 2px; background: var(--tl-empty); overflow: hidden; margin-top: 4px; }
.tilo-stats .ach-bar i { display: block; height: 100%; background: var(--tl-green); }
.tilo-stats .ach-val { font-size: 11px !important; }
.tilo-stats .day:hover { opacity: .8; }
.tilo-stats .zero-line { stroke: var(--tl-muted); stroke-width: 1; }
.tilo-stats .track { fill: var(--tl-empty); }
.tilo-stats .axis.label { font-size: 12px; fill: var(--tl-fg); }
.tilo-stats .lifts { display: grid; gap: 2px; }
.tilo-stats .lift { display: grid; grid-template-columns: minmax(0, 1fr) auto 80px; gap: 12px; padding: 5px 2px; border-bottom: 1px solid var(--tl-border); }
.tilo-stats .lift:last-child { border-bottom: 0; }
.tilo-stats .lift-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tilo-stats .lift-set { color: var(--tl-muted); }
.tilo-stats .lift-e1rm { text-align: right; font-weight: 600; }
.tilo-stats .key i.bar-blue { color: var(--tl-blue); } .tilo-stats .key i.bar-purple { color: var(--tl-purple); }
.tilo-stats .foot { font-size: 11px; color: var(--tl-muted); }
.tilo-stats .message { display: grid; justify-items: center; gap: 8px; text-align: center; padding: 80px 20px; }
.tilo-stats .message svg { width: 32px; height: 32px; color: var(--tl-green); }
.tilo-stats .message h2 { margin: 0; font-size: 16px; }
.tilo-stats .message p { margin: 0 0 8px; color: var(--tl-muted); max-width: 50ch; }
@media (prefers-reduced-motion: reduce) { .tilo-stats { transition: none; } }
`
