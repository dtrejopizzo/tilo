import { buildMonthStats, fetchRange, rangeToStats } from "@tilo/core/stats"
import * as vscode from "vscode"
import { estimateWithEditorModel } from "./editorAi"
import type { TiloState } from "./state"

// @tilo in the chat view: answers with the user's own model, grounded on their Tilo data
export function registerChat(context: vscode.ExtensionContext, state: TiloState) {
  if (!vscode.chat?.createChatParticipant) return
  const participant = vscode.chat.createChatParticipant("tilo.chat", async (request, _ctx, stream, token) => {
    const client = await state.client()
    if (!client) {
      stream.markdown("Tilo no está conectado. Corré **Tilo: Conectar** para usar tu token.")
      return
    }

    if (request.command === "log") {
      // Split the message into items and log each: meals estimated by the editor's model
      const parts = request.prompt.split(/\s*(?:,|;| y luego | y después |\n)\s*/i).filter(Boolean)
      for (const part of parts) {
        const r = await client.quickAdd(part, state.date).catch(async (e) => {
          if (String(e).match(/Pro|key|402/)) {
            const m = await estimateWithEditorModel(part, token)
            if (m) return client.addMeal({ description: part, date: state.date, ...m }).then((meal) => ({ summary: `${meal.description} · ${Math.round(meal.kcal)} kcal` }))
          }
          throw e
        })
        stream.markdown(`- ${r.summary}\n`)
      }
      await state.refresh()
      return
    }

    stream.progress("Leyendo tu Tilo…")
    await state.refresh()
    const v = state.view
    let context = JSON.stringify({
      date: state.date,
      tasks: v?.tasks,
      checklist: v?.checklist,
      nutrition: v?.nutrition,
      water: v?.water,
      energy: v && { total: v.energy.total, intake: v.energy.intake, balance: v.energy.balance, bmr: v.energy.bmr, neat: v.energy.neat, exercise: v.energy.exercise, confidence: v.energy.confidence },
      steps: v?.metrics.values.steps,
      training: v?.training,
      email: v?.email,
    })
    if (request.command === "review" || /semana|mes|tendencia|stats|progreso/i.test(request.prompt)) {
      const month = state.date.slice(0, 7)
      const { from, to } = fetchRange(month)
      const stats = buildMonthStats(month, rangeToStats(await client.getRange(from, to)), state.date)
      context += "\nMONTH: " + JSON.stringify({ kpis: stats.kpis, muscles: stats.muscles, lifts: stats.lifts, days: stats.elapsed.map((d) => ({ date: d.date, tasks: d.tasksCompleted, water: d.water, kcalIn: d.calories, kcalOut: d.kcalOut, steps: d.steps, sport: d.sportMinutes, habits: d.habitsDone })) })
    }
    const instruction =
      request.command === "plan"
        ? "Proponé un plan concreto para hoy: las 3 tareas más importantes (vencidas y de prioridad alta primero), cuándo entrenar y qué, cómo llegar a la proteína y al agua con lo que falta, y qué hábitos o suplementos quedan. Breve."
        : request.command === "review"
          ? "Hacé una revisión de la semana contra las anteriores: hábitos, entrenamiento y récords, pasos, balance energético vs peso, mail y foco. Marcá 2 o 3 patrones concretos que se vean en los números y proponé UNA acción para la semana. Menos de 200 palabras."
          : request.command === "hoy"
            ? "Resumí mi día en pocas líneas: qué está hecho, qué falta y una sugerencia."
            : request.prompt
    const messages = [
      vscode.LanguageModelChatMessage.User(`Sos el asistente de Tilo. Respondé en español rioplatense, breve y concreto, usando solo estos datos del usuario:\n${context}`),
      vscode.LanguageModelChatMessage.User(instruction),
    ]
    const res = await request.model.sendRequest(messages, {}, token)
    for await (const chunk of res.text) stream.markdown(chunk)
  })
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "tilo.svg")
  context.subscriptions.push(participant)
}
