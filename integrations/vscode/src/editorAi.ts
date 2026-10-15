import * as vscode from "vscode"

// Uses the editor's own language model (GitHub Copilot, etc.) through vscode.lm, so estimating
// a meal costs the user nothing extra and Tilo nothing at all. Falls back to Tilo's AI when absent.
export interface MealMacros {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  meal_type?: import("@tilo/core/apiTypes").MealType
}

const PROMPT = `You are a precise nutritionist. Estimate the meal below. Respect explicit quantities and brands
(Argentine foods are common: milanesa, empanada, medialuna…). If no quantity is given assume a standard serving.
Reply with ONLY a JSON object: {"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"meal_type":"breakfast"|"lunch"|"dinner"|"snack"}`

export async function estimateWithEditorModel(description: string, token?: vscode.CancellationToken): Promise<MealMacros | null> {
  if (!vscode.workspace.getConfiguration("tilo").get<boolean>("ai.useEditorModel")) return null
  try {
    const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" })
    if (!model) return null
    const res = await model.sendRequest([vscode.LanguageModelChatMessage.User(`${PROMPT}\n\nMeal: "${description}"`)], {}, token ?? new vscode.CancellationTokenSource().token)
    let text = ""
    for await (const chunk of res.text) text += chunk
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as MealMacros
    if (!(json.kcal >= 0)) return null
    return json
  } catch {
    return null
  }
}
