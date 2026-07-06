import tunedAvgJson from "../../../../tests/kingOfTheHillTune.avg.json"
import tunedMaxJson from "../../../../tests/kingOfTheHillTune.max.json"

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

export interface TunedBenchmarkMeta {
  seed: number
  difficulty: number
  count: number
  selection: "sequential"
}

interface TunedConfigFile {
  objective?: FitnessObjective
  avgGuesses?: number
  maxGuesses?: number
  totalGuesses?: number
  fitness?: number
  benchmark?: TunedBenchmarkMeta
  config: Omit<ImprovedConfig, "parabolicFlatEpsilon" | "rescanDivisors">
}

/** Raw gene values from tests/kingOfTheHillTune.max.json (C++ tuner output). */
export const TUNED_MAX_CONFIG = (tunedMaxJson as TunedConfigFile).config

/** Raw gene values from tests/kingOfTheHillTune.avg.json (C++ tuner output). */
export const TUNED_AVG_CONFIG = (tunedAvgJson as TunedConfigFile).config

export function getTunedBenchmark(objective: FitnessObjective = "max"): TunedBenchmarkMeta | null {
  const raw = (objective === "avg" ? tunedAvgJson : tunedMaxJson) as TunedConfigFile
  return raw.benchmark ?? null
}

export function getTunedJsonScores(objective: FitnessObjective = "max") {
  const raw = (objective === "avg" ? tunedAvgJson : tunedMaxJson) as TunedConfigFile
  return {
    avgGuesses: raw.avgGuesses ?? null,
    maxGuesses: raw.maxGuesses ?? null,
    totalGuesses: raw.totalGuesses ?? null,
  }
}

/** Add derived fields the solver reads; gene values are used as-is from the tuner JSON. */
export function finalizeImprovedConfig(
  raw: Omit<ImprovedConfig, "parabolicFlatEpsilon" | "rescanDivisors">,
): ImprovedConfig {
  const cfg = { ...raw } as ImprovedConfig
  cfg.enableGaussianEstimate = cfg.enableGaussianEstimate ? 1 : 0
  cfg.enableTernarySearch = cfg.enableTernarySearch ? 1 : 0
  cfg.enableExpandFromBest = cfg.enableExpandFromBest ? 1 : 0
  cfg.parabolicFlatEpsilon = 10 ** -cfg.parabolicFlatNegLog10
  cfg.rescanDivisors = [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3]
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  return cfg
}

export function getTunedImprovedConfig(objective: FitnessObjective = "max"): ImprovedConfig {
  return finalizeImprovedConfig(objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG)
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
