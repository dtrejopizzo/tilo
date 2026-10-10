// Supplement presets, daily micronutrient references and electrolyte suggestions.

export type SupplementUnit = "mg" | "mcg" | "iu" | "g" | "ml" | "caps" | "scoop"
export type SupplementSlot = "wake" | "breakfast" | "lunch" | "dinner" | "with_meal" | "pre_workout" | "post_workout" | "bed" | "any"

export interface SupplementPreset {
  key: string
  name: string
  dose: number
  unit: SupplementUnit
  slot: SupplementSlot
  withFood: boolean
  nutrients: Record<string, number> // per dose
  note?: string
  aliases: string[]
}

export const SLOT_LABELS: Record<SupplementSlot, string> = {
  wake: "Al despertar", breakfast: "Desayuno", lunch: "Almuerzo", dinner: "Cena", with_meal: "Con comidas",
  pre_workout: "Pre-entreno", post_workout: "Post-entreno", bed: "Antes de dormir", any: "Durante el día",
}

export const SUPPLEMENT_PRESETS: SupplementPreset[] = [
  { key: "vitamin_d3", name: "Vitamina D3", dose: 2000, unit: "iu", slot: "breakfast", withFood: true, nutrients: { vitamin_d_iu: 2000 }, aliases: ["d3", "vitamina d", "vit d"] },
  { key: "vitamin_k2", name: "Vitamina K2 (MK-7)", dose: 100, unit: "mcg", slot: "breakfast", withFood: true, nutrients: { vitamin_k_mcg: 100 }, aliases: ["k2", "mk7", "mk-7"] },
  { key: "vitamin_b12", name: "Vitamina B12", dose: 1000, unit: "mcg", slot: "breakfast", withFood: false, nutrients: { vitamin_b12_mcg: 1000 }, aliases: ["b12", "cobalamina", "metilcobalamina"] },
  { key: "vitamin_b2", name: "Vitamina B2 (riboflavina)", dose: 100, unit: "mg", slot: "breakfast", withFood: true, nutrients: { vitamin_b2_mg: 100 }, aliases: ["b2", "riboflavina"] },
  { key: "b_complex", name: "Complejo B", dose: 1, unit: "caps", slot: "breakfast", withFood: true, nutrients: { vitamin_b1_mg: 25, vitamin_b2_mg: 25, vitamin_b6_mg: 25, vitamin_b12_mcg: 100, folate_mcg: 400 }, aliases: ["complejo b", "b complex"] },
  { key: "vitamin_c", name: "Vitamina C", dose: 500, unit: "mg", slot: "breakfast", withFood: false, nutrients: { vitamin_c_mg: 500 }, aliases: ["vit c", "vitamina c", "c"] },
  { key: "vitamin_a", name: "Vitamina A", dose: 900, unit: "mcg", slot: "lunch", withFood: true, nutrients: { vitamin_a_mcg: 900 }, aliases: ["vit a", "vitamina a", "retinol"] },
  { key: "multivitamin", name: "Multivitamínico", dose: 1, unit: "caps", slot: "breakfast", withFood: true, nutrients: { vitamin_a_mcg: 450, vitamin_c_mg: 90, vitamin_d_iu: 1000, vitamin_e_mg: 15, zinc_mg: 11, vitamin_b12_mcg: 6 }, aliases: ["multi", "multivitaminico", "multivitamínico"] },
  { key: "magnesium", name: "Magnesio (bisglicinato)", dose: 300, unit: "mg", slot: "bed", withFood: false, nutrients: { magnesium_mg: 300 }, aliases: ["magnesio", "mg"] },
  { key: "zinc", name: "Zinc", dose: 15, unit: "mg", slot: "dinner", withFood: true, nutrients: { zinc_mg: 15 }, aliases: ["zinc", "zn"] },
  { key: "iron", name: "Hierro", dose: 18, unit: "mg", slot: "breakfast", withFood: false, nutrients: { iron_mg: 18 }, aliases: ["hierro"] },
  { key: "calcium", name: "Calcio", dose: 500, unit: "mg", slot: "dinner", withFood: true, nutrients: { calcium_mg: 500 }, aliases: ["calcio"] },
  { key: "omega3", name: "Omega-3", dose: 1, unit: "g", slot: "with_meal", withFood: true, nutrients: { omega3_g: 1 }, aliases: ["omega 3", "omega3", "aceite de pescado"] },
  { key: "creatine", name: "Creatina", dose: 5, unit: "g", slot: "any", withFood: false, nutrients: { creatine_g: 5 }, aliases: ["creatina", "creatine"] },
  { key: "whey", name: "Proteína whey", dose: 30, unit: "g", slot: "post_workout", withFood: false, nutrients: { kcal: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5 }, aliases: ["whey", "proteina", "proteína", "batido"] },
  { key: "electrolytes", name: "Electrolitos", dose: 1, unit: "scoop", slot: "pre_workout", withFood: false, nutrients: { sodium_mg: 500, potassium_mg: 200, magnesium_mg: 60 }, aliases: ["electrolitos", "sales", "lmnt"] },
  { key: "caffeine", name: "Cafeína", dose: 200, unit: "mg", slot: "pre_workout", withFood: false, nutrients: { caffeine_mg: 200 }, aliases: ["cafeina", "cafeína", "pre entreno"] },
  { key: "melatonin", name: "Melatonina", dose: 1, unit: "mg", slot: "bed", withFood: false, nutrients: { melatonin_mg: 1 }, aliases: ["melatonina"] },
  { key: "ashwagandha", name: "Ashwagandha", dose: 600, unit: "mg", slot: "bed", withFood: true, nutrients: {}, aliases: ["ashwagandha"] },
  { key: "collagen", name: "Colágeno", dose: 10, unit: "g", slot: "breakfast", withFood: false, nutrients: { protein_g: 9, kcal: 36 }, aliases: ["colageno", "colágeno"] },
]

// Adult daily references (RDA/AI; upper limits where relevant)
export const NUTRIENT_REFERENCE: Record<string, { label: string; unit: string; target: number; upper?: number }> = {
  vitamin_d_iu: { label: "Vitamina D", unit: "UI", target: 800, upper: 4000 },
  vitamin_k_mcg: { label: "Vitamina K", unit: "mcg", target: 120 },
  vitamin_b12_mcg: { label: "Vitamina B12", unit: "mcg", target: 2.4 },
  vitamin_b2_mg: { label: "Vitamina B2", unit: "mg", target: 1.3 },
  vitamin_b6_mg: { label: "Vitamina B6", unit: "mg", target: 1.7, upper: 100 },
  vitamin_b1_mg: { label: "Vitamina B1", unit: "mg", target: 1.2 },
  folate_mcg: { label: "Folato", unit: "mcg", target: 400, upper: 1000 },
  vitamin_a_mcg: { label: "Vitamina A", unit: "mcg", target: 900, upper: 3000 },
  vitamin_c_mg: { label: "Vitamina C", unit: "mg", target: 90, upper: 2000 },
  vitamin_e_mg: { label: "Vitamina E", unit: "mg", target: 15, upper: 1000 },
  magnesium_mg: { label: "Magnesio", unit: "mg", target: 420 },
  zinc_mg: { label: "Zinc", unit: "mg", target: 11, upper: 40 },
  iron_mg: { label: "Hierro", unit: "mg", target: 8, upper: 45 },
  calcium_mg: { label: "Calcio", unit: "mg", target: 1000, upper: 2500 },
  sodium_mg: { label: "Sodio", unit: "mg", target: 1500, upper: 2300 },
  potassium_mg: { label: "Potasio", unit: "mg", target: 3400 },
  omega3_g: { label: "Omega-3", unit: "g", target: 1.6 },
  caffeine_mg: { label: "Cafeína", unit: "mg", target: 0, upper: 400 },
}

export function findPreset(text: string): SupplementPreset | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
  let best: { p: SupplementPreset; len: number } | null = null
  for (const p of SUPPLEMENT_PRESETS) {
    for (const a of [p.name.toLowerCase(), ...p.aliases]) {
      const alias = a.normalize("NFD").replace(/[̀-ͯ]/g, "")
      const re = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$|\\d)`)
      if (re.test(t) && (!best || alias.length > best.len)) best = { p, len: alias.length }
    }
  }
  return best?.p ?? null
}

// Sums nutrients from supplements taken and meals' micros
export function sumNutrients(sources: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const src of sources) for (const [k, v] of Object.entries(src)) out[k] = (out[k] ?? 0) + v
  return out
}

// Sweat-loss based suggestion for long or hard sessions
export function electrolyteSuggestion(minutes: number, avgHr: number | null, maxHr = 190): { sodiumMg: number; waterMl: number; reason: string } | null {
  if (minutes < 60 && !(avgHr && avgHr > maxHr * 0.8 && minutes >= 45)) return null
  const intensity = avgHr ? Math.min(1.3, Math.max(0.7, avgHr / (maxHr * 0.75))) : 1
  const sweatL = (minutes / 60) * 0.8 * intensity
  return {
    sodiumMg: Math.round((sweatL * 900) / 50) * 50,
    waterMl: Math.round((sweatL * 1000) / 50) * 50,
    reason: `${minutes} min${avgHr ? ` a ${avgHr} lpm` : ""}: perdiste ~${sweatL.toFixed(1)} L de sudor`,
  }
}
