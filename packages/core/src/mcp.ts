// Tilo's MCP tools and prompts, defined once and served two ways:
// locally over stdio (integrations/mcp, TiloClient over HTTP) and remotely at /api/mcp (in-process TiloApi).
// Tools that need judgement (estimating a meal, planning a day) let the caller's own model do the
// thinking and only store results, so the user's AI subscription pays for it, not Tilo's.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { TiloApi } from "./client"
import { buildMonthStats, fetchRange, rangeToStats } from "./stats"
import { buildToday } from "./today"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Day in YYYY-MM-DD (the user's local date). Defaults to today.")

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }
}

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn())
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: `Tilo error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    }
  }
}

export function registerTiloTools(server: McpServer, api: TiloApi, today: () => string) {
  server.registerTool(
    "get_today",
    {
      title: "Today in Tilo",
      description:
        "The user's day: tasks due/overdue/upcoming, habits and supplements checklist, meals with macros vs goals, water, " +
        "caffeine, steps and device metrics, energy expenditure breakdown (BMR, NEAT, exercise, TEF) and balance, today's " +
        "training routine with progression suggestions, workouts and activities, inbox summary and important emails. " +
        "Call this first; it returns the IDs other tools need.",
      inputSchema: { date },
      annotations: { readOnlyHint: true },
    },
    ({ date: d }) =>
      run(async () => {
        const day = await api.getDay(d ?? today())
        const view = buildToday(day)
        return {
          date: view.date,
          tasks: view.tasks,
          checklist: view.checklist,
          nutrition: view.nutrition,
          meals: day.meals.map((m) => ({ id: m.id, description: m.description, kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, meal_type: m.meal_type })),
          water: view.water,
          caffeine: view.caffeine,
          metrics: view.metrics,
          energy: view.energy,
          weight: view.weight,
          training: { ...view.training, workouts: day.workouts.map((w) => ({ id: w.id, name: w.name, ended: !!w.ended_at, sets: w.sets.length })) },
          email: view.email,
          projects: day.projects.map((p) => p.name),
        }
      }),
  )

  server.registerTool(
    "get_month_stats",
    {
      title: "Monthly stats",
      description:
        "Stats for a month: habit completion and streaks, tasks per day, water, calories and energy balance, steps, training " +
        "volume per muscle, best lifts, inbox trend and focus time. Use it for reviews and trends.",
      inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, defaults to the current month") },
      annotations: { readOnlyHint: true },
    },
    ({ month }) =>
      run(async () => {
        const m = month ?? today().slice(0, 7)
        const { from, to } = fetchRange(m)
        const stats = buildMonthStats(m, rangeToStats(await api.getRange(from, to)), today())
        return {
          month: stats.label,
          kpis: stats.kpis,
          muscles: stats.muscles,
          lifts: stats.lifts,
          habits: stats.habits.map((h) => ({ name: h.name, frequency: h.frequency, completions: h.count })),
          days: stats.elapsed.map(({ date: d, tasksCompleted, water, calories, kcalOut, steps, sportMinutes, habitsDone, inboxTotal }) => ({
            date: d, tasksCompleted, water, calories, kcalOut, steps, sportMinutes, habitsDone, inboxTotal,
          })),
        }
      }),
  )

  server.registerTool(
    "quick_add",
    {
      title: "Log anything",
      description:
        "Log one thing in natural language (Spanish or English) and Tilo figures out what it is: water (\"500 agua\"), " +
        "weight (\"peso 78.6\"), a strength set (\"press banca 80x8x3\"), cardio (\"corrí 5 km en 25 min\"), a task " +
        "(\"tarea: llamar al contador mañana !alta #work\"), a habit or supplement by name, caffeine, a check-in (\"energía 4\"), " +
        "or a meal (anything else; Tilo estimates macros). For meals, prefer log_meal with your own estimate.",
      inputSchema: { text: z.string().min(1), date },
    },
    ({ text, date: d }) => run(() => api.quickAdd(text, d ?? today())),
  )

  server.registerTool(
    "log_meal",
    {
      title: "Log meal",
      description:
        "Log a meal. Estimate calories and macros yourself from the description (be precise with quantities, brands and " +
        "cooking method) and pass them: this is free for the user. Leave them out only if you can't estimate; then Tilo's " +
        "AI does it, which may need Tilo Pro.",
      inputSchema: {
        description: z.string().min(1),
        meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
        kcal: z.number().min(0).max(5000).optional(),
        protein_g: z.number().min(0).max(500).optional(),
        carbs_g: z.number().min(0).max(800).optional(),
        fat_g: z.number().min(0).max(400).optional(),
        fiber_g: z.number().min(0).max(150).optional(),
        date,
      },
    },
    ({ date: d, ...meal }) => run(() => api.addMeal({ ...meal, date: d ?? today() })),
  )

  server.registerTool(
    "add_task",
    {
      title: "Add task",
      description: "Create a task. Projects are matched by name (see get_today.projects).",
      inputSchema: {
        title: z.string().min(1),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        project: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    (input) => run(() => api.addTask({ ...input, source: "mcp" })),
  )

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description: "Complete, reopen, reschedule or edit a task by id (ids come from get_today).",
      inputSchema: {
        id: z.string(),
        status: z.enum(["todo", "done"]).optional(),
        title: z.string().optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        notes: z.string().optional(),
        date,
      },
      annotations: { idempotentHint: true },
    },
    ({ id, date: d, ...patch }) => run(() => api.updateTask(id, patch, d ?? today())),
  )

  server.registerTool(
    "check_item",
    {
      title: "Check off habit or supplement",
      description: "Mark a habit as done or a supplement as taken (or undo it). Ids and kinds come from get_today.checklist.",
      inputSchema: { kind: z.enum(["habit", "supplement"]), id: z.string(), done: z.boolean().default(true), date },
      annotations: { idempotentHint: true },
    },
    ({ kind, id, done, date: d }) =>
      run(() => (kind === "habit" ? api.setHabit(id, done, d ?? today()) : api.setSupplement(id, done, d ?? today()))),
  )

  server.registerTool(
    "log_water",
    {
      title: "Log water",
      description: "Add water in millilitres (a glass is about 250 ml).",
      inputSchema: { ml: z.number().int().positive().max(5000), date },
    },
    ({ ml, date: d }) => run(() => api.addWater(ml, d ?? today())),
  )

  server.registerTool(
    "log_weight",
    {
      title: "Log weight",
      description: "Record body weight in kg, optionally body fat %.",
      inputSchema: { kg: z.number().min(20).max(400), body_fat_pct: z.number().min(2).max(70).optional(), date },
    },
    ({ kg, body_fat_pct, date: d }) => run(() => api.addWeight(kg, body_fat_pct, d ?? today())),
  )

  server.registerTool(
    "start_workout",
    {
      title: "Start workout",
      description: "Start a gym session, from today's routine (routine_id from get_today.training) or ad hoc. Returns the workout id for log_set.",
      inputSchema: { name: z.string().optional(), routine_id: z.string().optional(), date },
    },
    ({ date: d, ...input }) => run(() => api.startWorkout({ ...input, date: d ?? today() })),
  )

  server.registerTool(
    "log_set",
    {
      title: "Log set",
      description:
        "Log one set in a workout. Name the exercise in Spanish or English (\"press banca\", \"sentadilla\", \"lat pulldown\"). " +
        "Returns whether it was a personal record.",
      inputSchema: {
        workout_id: z.string(),
        exercise: z.string().describe("Exercise name"),
        weight_kg: z.number().min(0).max(600),
        reps: z.number().int().min(0).max(500),
        rpe: z.number().min(1).max(10).optional(),
        is_warmup: z.boolean().optional(),
      },
    },
    ({ workout_id, exercise, ...set }) => run(() => api.addSet(workout_id, { exercise_name: exercise, ...set })),
  )

  server.registerTool(
    "finish_workout",
    {
      title: "Finish workout",
      description: "Close a workout so its duration counts toward energy and stats.",
      inputSchema: { workout_id: z.string(), notes: z.string().optional() },
    },
    ({ workout_id, notes }) => run(() => api.finishWorkout(workout_id, notes)),
  )

  server.registerTool(
    "log_checkin",
    {
      title: "Energy and mood check-in",
      description: "Record how the user feels, 1 (low) to 5 (great).",
      inputSchema: { energy: z.number().int().min(1).max(5).optional(), mood: z.number().int().min(1).max(5).optional(), note: z.string().optional(), date },
    },
    ({ date: d, ...input }) => run(() => api.addCheckin({ ...input, date: d ?? today() })),
  )

  server.registerTool(
    "start_focus",
    {
      title: "Start focus session",
      description: "Start a focus (pomodoro) session, optionally on a task. Returns the session id for stop_focus.",
      inputSchema: { task_id: z.string().optional(), planned_min: z.number().int().min(5).max(240).optional() },
    },
    (input) => run(() => api.startFocus({ ...input, source: "mcp", date: today() })),
  )

  server.registerTool(
    "stop_focus",
    {
      title: "Stop focus session",
      description: "Stop a running focus session.",
      inputSchema: { id: z.string() },
    },
    ({ id }) => run(() => api.stopFocus(id)),
  )

  server.registerPrompt(
    "plan_my_day",
    {
      title: "Plan my day",
      description: "Look at today in Tilo and propose a realistic plan: top 3 tasks, training, meals and habits.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Use get_today. Then give me a short plan for today: my 3 most important tasks (overdue and high priority first, " +
              "fit them around my meetings), when to train and what (use the routine and progression suggestions), how to hit my " +
              "protein and water goals with the meals left, and the habits/supplements still open. Be concise and concrete. " +
              "Ask before creating or changing anything.",
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly review",
      description: "Review the last weeks in Tilo: what went well, patterns, and one concrete change for next week.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Use get_month_stats (and the previous month if we're early in this one). Review my last 7 days against the " +
              "previous weeks: habits and streaks, training volume and records, steps, energy balance vs. my weight trend, " +
              "sleep, inbox and focus. Point out 2–3 patterns you see in the numbers (e.g. what happens on days I train vs. " +
              "don't) and suggest ONE concrete change for next week. Keep it under 200 words.",
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    "log_my_day",
    {
      title: "Log my day",
      description: "Tell Tilo everything you ate, drank and did in one message; it logs each item.",
      argsSchema: { text: z.string().describe("Everything you want to log, in your own words") },
    },
    ({ text }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Log this in Tilo, item by item: "${text}". Use log_meal with your own calorie and macro estimates for food, ` +
              "log_water for drinks with water, quick_add for everything else (sets, weight, supplements, tasks, habits). " +
              "Then summarise what you logged in a short list.",
          },
        },
      ],
    }),
  )
}
