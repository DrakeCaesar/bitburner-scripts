import { CityName, CorpMaterialName } from "@ns"
import { numbersClose } from "@/libraries/corporation/simulation/math.js"
import type {
  CorporationSnapshot,
  CorpStage,
  FieldComparison,
  MaterialSnapshot,
  StageValidationResult,
} from "@/libraries/corporation/simulation/types.js"

const TRACKED_FIELDS: (keyof MaterialSnapshot)[] = ["stored", "productionAmount", "actualSellAmount", "buyAmount"]

function compareField(path: string, predicted: number, actual: number, relTol: number, absTol: number): FieldComparison {
  const delta = predicted - actual
  const relError = actual !== 0 ? Math.abs(delta / actual) : predicted === 0 ? 0 : null
  const ok = numbersClose(predicted, actual, relTol, absTol)
  return { path, predicted, actual, delta, relError, ok }
}

function compareMaterial(
  pathPrefix: string,
  before: MaterialSnapshot | undefined,
  predicted: MaterialSnapshot | undefined,
  actual: MaterialSnapshot | undefined,
  stage: CorpStage,
  relTol: number,
  absTol: number
): FieldComparison[] {
  const rows: FieldComparison[] = []
  if (!actual) return rows

  for (const field of TRACKED_FIELDS) {
    const a = actual[field] as number
    const p = predicted?.[field] as number | undefined
    if (p == null && field === "buyAmount" && stage !== "PURCHASE") continue
    if (p == null) {
      rows.push({
        path: `${pathPrefix}.${field}`,
        predicted: NaN,
        actual: a,
        delta: NaN,
        relError: null,
        ok: false,
      })
      continue
    }
    rows.push(compareField(`${pathPrefix}.${field}`, p, a, relTol, absTol))
  }

  if (before && actual && predicted) {
    const actualDelta = actual.stored - before.stored
    const predictedDelta = predicted.stored - before.stored
    rows.push(compareField(`${pathPrefix}.Δstored`, predictedDelta, actualDelta, relTol, absTol))
  }

  return rows
}

export function compareStageSnapshots(
  stage: CorpStage,
  divisionName: string,
  city: CityName,
  before: CorporationSnapshot,
  predicted: CorporationSnapshot,
  actual: CorporationSnapshot,
  options?: { relTol?: number; absTol?: number }
): StageValidationResult {
  const relTol = options?.relTol ?? 0.03
  const absTol = options?.absTol ?? 1
  const notes: string[] = []

  const divBefore = before.divisions.find((d) => d.name === divisionName)
  const divPredicted = predicted.divisions.find((d) => d.name === divisionName)
  const divActual = actual.divisions.find((d) => d.name === divisionName)

  const comparisons: FieldComparison[] = []

  if (!divActual) {
    return { stage, division: divisionName, city, comparisons, allOk: false, notes: ["Division missing in actual snapshot"] }
  }

  const whBefore = divBefore?.warehouses.find((w) => w.city === city)
  const whPredicted = divPredicted?.warehouses.find((w) => w.city === city)
  const whActual = divActual.warehouses.find((w) => w.city === city)

  if (!whActual) {
    return { stage, division: divisionName, city, comparisons, allOk: false, notes: ["Warehouse missing in actual snapshot"] }
  }

  const materialNames = new Set<CorpMaterialName>()
  for (const n of divActual.producedMaterials) materialNames.add(n)
  for (const n of Object.keys(divActual.requiredMaterials) as CorpMaterialName[]) materialNames.add(n)

  for (const name of materialNames) {
    comparisons.push(
      ...compareMaterial(
        name,
        whBefore?.materials[name],
        whPredicted?.materials[name],
        whActual.materials[name],
        stage,
        relTol,
        absTol
      )
    )
  }

  if (stage === "START") {
    comparisons.push(
      compareField(
        "popularity",
        divPredicted?.popularity ?? NaN,
        divActual.popularity,
        relTol,
        0.0001
      )
    )
  }

  if (stage === "SALE") {
    const hasTa = Object.values(whActual.materials).some((m) => m?.marketTa1 || m?.marketTa2)
    if (hasTa) notes.push("Market-TA enabled: sale model may diverge (TA not fully modeled)")
  }

  if (stage === "PRODUCTION") {
    const plants = whActual.materials[divActual.producedMaterials[0]]
    const plantsBefore = whBefore?.materials[divActual.producedMaterials[0]]
    const plantsPred = whPredicted?.materials[divActual.producedMaterials[0]]
    if (plants && plantsBefore && plantsPred) {
      const actualGain = plants.stored - plantsBefore.stored
      const predGain = plantsPred.stored - plantsBefore.stored
      if (actualGain > 0 && predGain > 0 && !numbersClose(predGain, actualGain, 0.05, 2)) {
        const scale = actualGain / predGain
        notes.push(`Inferred corp production scale ≈ ${scale.toFixed(4)} (pred×scale vs actual Plants Δstored)`)
      }
    }
  }

  const allOk = comparisons.length > 0 && comparisons.every((c) => c.ok)

  return { stage, division: divisionName, city, comparisons, allOk, notes }
}
