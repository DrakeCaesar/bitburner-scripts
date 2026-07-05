export interface ImprovedConfig {
  clusterMargin: number
  clusterDetectAlt: number
  mainPeakModeAlt: number
  refinePeakCountMain: number
  findHillQuickRounds: number
  coarseMinDivisor: number
  coarseHillFactor: number
  rescanDivisor1: number
  rescanDivisor2: number
  rescanDivisor3: number
  refineSpanHillDivisor: number
  refineCoarsePasses: number
  refineFinePasses: number
  refineRadiusShrink: number
  refineStepShrink: number
  sideHillSweepWidthDivisor: number
  centroidMinAlt: number
  centroidAltFraction: number
  centroidRefineRadius: number
  centroidRefinePasses: number
  hillClimbInitialDivisor: number
  hillClimbShrink: number
  hillClimbFlatAltDelta: number
  zoomInitialDivisor: number
  zoomMaxPasses: number
  zoomStepDivisor: number
  parabolicFlatEpsilon: number
  mainPeakDetectAlt: number
  mainPeakWindowWidths: number
  gaussEstimateMinAlt: number
  gaussHeightFraction: number
  enableGaussianEstimate: number
  ternaryMaxItersCap: number
  ternaryWidthStop: number
  ternarySpanDivisor: number
  enableTernarySearch: number
  expandMaxStepDivisor: number
  expandStepMultiplier: number
  enableExpandFromBest: number
  subdivNarrowStepFactor: number
  enableSubdivNarrow: number
  centroidLogWeight: number
  finalMainRadius: number
  finalSideMinRadius: number
  finalSideMaxRadius: number
  finalSideSpanDivisor: number
  finalTinySpan: number
  parabolicFlatNegLog10: number
  rescanDivisors: number[]
}

export type FitnessObjective = "max" | "avg"

const TUNABLE_SPECS = [
  { key: "clusterMargin", min: 1.0, max: 1.3, step: 0.05, type: "float" as const },
  { key: "clusterDetectAlt", min: 300, max: 800, step: 50, type: "int" as const },
  { key: "mainPeakModeAlt", min: 9000, max: 9900, step: 100, type: "int" as const },
  { key: "refinePeakCountMain", min: 1, max: 3, step: 1, type: "int" as const },
  { key: "findHillQuickRounds", min: 1, max: 5, step: 1, type: "int" as const },
  { key: "coarseMinDivisor", min: 40, max: 80, step: 4, type: "int" as const },
  { key: "coarseHillFactor", min: 4, max: 12, step: 1, type: "int" as const },
  { key: "rescanDivisor1", min: 0, max: 200, step: 10, type: "int" as const },
  { key: "rescanDivisor2", min: 0, max: 400, step: 20, type: "int" as const },
  { key: "rescanDivisor3", min: 0, max: 900, step: 50, type: "int" as const },
  { key: "refineSpanHillDivisor", min: 2, max: 6, step: 1, type: "int" as const },
  { key: "refineCoarsePasses", min: 3, max: 7, step: 1, type: "int" as const },
  { key: "refineFinePasses", min: 2, max: 6, step: 1, type: "int" as const },
  { key: "refineRadiusShrink", min: 3, max: 10, step: 1, type: "int" as const },
  { key: "refineStepShrink", min: 2, max: 5, step: 1, type: "int" as const },
  { key: "sideHillSweepWidthDivisor", min: 1, max: 4, step: 1, type: "int" as const },
  { key: "centroidMinAlt", min: 8000, max: 9600, step: 100, type: "int" as const },
  { key: "centroidAltFraction", min: 0.8, max: 0.95, step: 0.01, type: "float" as const },
  { key: "centroidRefineRadius", min: 6, max: 20, step: 2, type: "int" as const },
  { key: "centroidRefinePasses", min: 2, max: 6, step: 1, type: "int" as const },
  { key: "hillClimbInitialDivisor", min: 32, max: 128, step: 8, type: "int" as const },
  { key: "hillClimbShrink", min: 2, max: 8, step: 1, type: "int" as const },
  { key: "hillClimbFlatAltDelta", min: 0.001, max: 0.1, step: 0.005, type: "float" as const },
  { key: "zoomInitialDivisor", min: 20, max: 80, step: 5, type: "int" as const },
  { key: "zoomMaxPasses", min: 4, max: 12, step: 1, type: "int" as const },
  { key: "zoomStepDivisor", min: 4, max: 16, step: 1, type: "int" as const },
  { key: "parabolicFlatNegLog10", min: 6, max: 15, step: 1, type: "int" as const },
  { key: "mainPeakDetectAlt", min: 6500, max: 8500, step: 100, type: "int" as const },
  { key: "mainPeakWindowWidths", min: 2, max: 6, step: 1, type: "int" as const },
  { key: "gaussEstimateMinAlt", min: 0, max: 500, step: 25, type: "int" as const },
  { key: "gaussHeightFraction", min: 0.85, max: 1.0, step: 0.01, type: "float" as const },
  { key: "enableGaussianEstimate", min: 0, max: 1, step: 1, type: "int" as const },
  { key: "ternaryMaxItersCap", min: 8, max: 128, step: 4, type: "int" as const },
  { key: "ternaryWidthStop", min: 1, max: 12, step: 1, type: "int" as const },
  { key: "ternarySpanDivisor", min: 2, max: 8, step: 1, type: "int" as const },
  { key: "enableTernarySearch", min: 0, max: 1, step: 1, type: "int" as const },
  { key: "expandMaxStepDivisor", min: 1, max: 8, step: 1, type: "int" as const },
  { key: "expandStepMultiplier", min: 2, max: 4, step: 1, type: "int" as const },
  { key: "enableExpandFromBest", min: 0, max: 1, step: 1, type: "int" as const },
  { key: "subdivNarrowStepFactor", min: 1, max: 6, step: 1, type: "int" as const },
  { key: "enableSubdivNarrow", min: 0, max: 1, step: 1, type: "int" as const },
  { key: "centroidLogWeight", min: 0.0, max: 1.0, step: 0.1, type: "float" as const },
  { key: "finalMainRadius", min: 3, max: 20, step: 1, type: "int" as const },
  { key: "finalSideMinRadius", min: 10, max: 50, step: 5, type: "int" as const },
  { key: "finalSideMaxRadius", min: 50, max: 150, step: 5, type: "int" as const },
  { key: "finalSideSpanDivisor", min: 20, max: 80, step: 5, type: "int" as const },
  { key: "finalTinySpan", min: 6, max: 24, step: 2, type: "int" as const },
]

export function defaultImprovedConfig(): ImprovedConfig {
  return normalizeImprovedConfig({})
}

/** Tuned for lowest max guesses (tests/kingOfTheHillTune.max.json). */
export const TUNED_MAX_CONFIG: Partial<ImprovedConfig> = {
  clusterMargin: 1.05,
  clusterDetectAlt: 300,
  mainPeakModeAlt: 9000,
  refinePeakCountMain: 1,
  findHillQuickRounds: 4,
  coarseMinDivisor: 40,
  coarseHillFactor: 4,
  rescanDivisor1: 7,
  rescanDivisor2: 120,
  rescanDivisor3: 50,
  refineSpanHillDivisor: 6,
  refineCoarsePasses: 3,
  refineFinePasses: 2,
  refineRadiusShrink: 3,
  refineStepShrink: 3,
  sideHillSweepWidthDivisor: 4,
  centroidMinAlt: 8400,
  centroidAltFraction: 0.81,
  centroidRefineRadius: 12,
  centroidRefinePasses: 2,
  hillClimbInitialDivisor: 104,
  hillClimbShrink: 7,
  hillClimbFlatAltDelta: 0.036,
  zoomInitialDivisor: 35,
  zoomMaxPasses: 12,
  zoomStepDivisor: 16,
  parabolicFlatNegLog10: 8,
  mainPeakDetectAlt: 6500,
  mainPeakWindowWidths: 3,
  gaussEstimateMinAlt: 500,
  gaussHeightFraction: 1,
  enableGaussianEstimate: 1,
  ternaryMaxItersCap: 24,
  ternaryWidthStop: 1,
  ternarySpanDivisor: 5,
  enableTernarySearch: 0,
  expandMaxStepDivisor: 8,
  expandStepMultiplier: 4,
  enableExpandFromBest: 1,
  subdivNarrowStepFactor: 1,
  enableSubdivNarrow: 1,
  centroidLogWeight: 0.5,
  finalMainRadius: 3,
  finalSideMinRadius: 35,
  finalSideMaxRadius: 110,
  finalSideSpanDivisor: 20,
  finalTinySpan: 24,
}

/** Tuned for lowest average guesses (tests/kingOfTheHillTune.avg.json). */
export const TUNED_AVG_CONFIG: Partial<ImprovedConfig> = {
  clusterMargin: 1.1,
  clusterDetectAlt: 300,
  mainPeakModeAlt: 9000,
  refinePeakCountMain: 1,
  findHillQuickRounds: 4,
  coarseMinDivisor: 40,
  coarseHillFactor: 4,
  rescanDivisor1: 8,
  rescanDivisor2: 78,
  rescanDivisor3: 1,
  refineSpanHillDivisor: 6,
  refineCoarsePasses: 4,
  refineFinePasses: 2,
  refineRadiusShrink: 5,
  refineStepShrink: 5,
  sideHillSweepWidthDivisor: 4,
  centroidMinAlt: 8000,
  centroidAltFraction: 0.94,
  centroidRefineRadius: 8,
  centroidRefinePasses: 2,
  hillClimbInitialDivisor: 112,
  hillClimbShrink: 3,
  hillClimbFlatAltDelta: 0.006,
  zoomInitialDivisor: 41,
  zoomMaxPasses: 8,
  zoomStepDivisor: 13,
  parabolicFlatNegLog10: 9,
  mainPeakDetectAlt: 6500,
  mainPeakWindowWidths: 3,
  gaussEstimateMinAlt: 50,
  gaussHeightFraction: 1,
  enableGaussianEstimate: 1,
  ternaryMaxItersCap: 52,
  ternaryWidthStop: 7,
  ternarySpanDivisor: 4,
  enableTernarySearch: 0,
  expandMaxStepDivisor: 6,
  expandStepMultiplier: 4,
  enableExpandFromBest: 0,
  subdivNarrowStepFactor: 1,
  enableSubdivNarrow: 1,
  centroidLogWeight: 0.4,
  finalMainRadius: 3,
  finalSideMinRadius: 10,
  finalSideMaxRadius: 55,
  finalSideSpanDivisor: 40,
  finalTinySpan: 14,
}

export function getTunedImprovedConfig(objective: FitnessObjective = "max"): ImprovedConfig {
  return normalizeImprovedConfig(objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG)
}

export function normalizeImprovedConfig(overrides: Partial<ImprovedConfig> = {}): ImprovedConfig {
  const base = {
    clusterMargin: 1.1,
    clusterDetectAlt: 500,
    mainPeakModeAlt: 9600,
    refinePeakCountMain: 1,
    findHillQuickRounds: 3,
    coarseMinDivisor: 56,
    coarseHillFactor: 8,
    rescanDivisor1: 100,
    rescanDivisor2: 280,
    rescanDivisor3: 750,
    refineSpanHillDivisor: 3,
    refineCoarsePasses: 5,
    refineFinePasses: 4,
    refineRadiusShrink: 6,
    refineStepShrink: 3,
    sideHillSweepWidthDivisor: 2,
    centroidMinAlt: 9000,
    centroidAltFraction: 0.88,
    centroidRefineRadius: 12,
    centroidRefinePasses: 4,
    hillClimbInitialDivisor: 64,
    hillClimbShrink: 4,
    hillClimbFlatAltDelta: 0.01,
    zoomInitialDivisor: 40,
    zoomMaxPasses: 8,
    zoomStepDivisor: 8,
    parabolicFlatEpsilon: 1e-12,
    mainPeakDetectAlt: 7500,
    mainPeakWindowWidths: 3,
    gaussEstimateMinAlt: 50,
    gaussHeightFraction: 1.0,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 64,
    ternaryWidthStop: 4,
    ternarySpanDivisor: 3,
    enableTernarySearch: 1,
    expandMaxStepDivisor: 1,
    expandStepMultiplier: 2,
    enableExpandFromBest: 1,
    subdivNarrowStepFactor: 2,
    enableSubdivNarrow: 1,
    centroidLogWeight: 1.0,
    finalMainRadius: 9,
    finalSideMinRadius: 25,
    finalSideMaxRadius: 99,
    finalSideSpanDivisor: 40,
    finalTinySpan: 12,
    parabolicFlatNegLog10: 12,
    rescanDivisors: [] as number[],
  }
  const cfg = { ...base, ...overrides } as ImprovedConfig
  for (const spec of TUNABLE_SPECS) {
    const key = spec.key as keyof ImprovedConfig
    const v = cfg[key] as number
    if (spec.type === "int") {
      ;(cfg as unknown as Record<string, number>)[spec.key] = Math.round(Math.max(spec.min, Math.min(spec.max, v)))
    } else {
      const clamped = Math.max(spec.min, Math.min(spec.max, v))
      const steps = Math.round((clamped - spec.min) / spec.step)
      ;(cfg as unknown as Record<string, number>)[spec.key] = spec.min + steps * spec.step
    }
  }
  cfg.enableGaussianEstimate = cfg.enableGaussianEstimate ? 1 : 0
  cfg.enableTernarySearch = cfg.enableTernarySearch ? 1 : 0
  cfg.enableExpandFromBest = cfg.enableExpandFromBest ? 1 : 0
  cfg.enableSubdivNarrow = cfg.enableSubdivNarrow ? 1 : 0
  cfg.parabolicFlatEpsilon = 10 ** -cfg.parabolicFlatNegLog10
  cfg.rescanDivisors = [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3].filter((d) => d > 0).sort((a, b) => a - b)
  return cfg
}

export function computeImprovedFitness(
  objective: FitnessObjective,
  unsolved: number,
  totalGuesses: number,
  maxGuesses: number,
): number {
  if (unsolved > 0) return Number.MAX_SAFE_INTEGER - unsolved * 1e9 + totalGuesses
  if (objective === "max") return maxGuesses * 1_000_000 + totalGuesses
  return totalGuesses * 1000 + maxGuesses
}
