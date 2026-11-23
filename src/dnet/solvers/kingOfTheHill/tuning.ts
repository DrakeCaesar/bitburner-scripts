/** Heuristic knobs for ladder / ladder_snipe (not generator-derived). */

export interface LadderSnipeTuning {
  farTailAnchorMaxAbs: number
  ladderEntryMaxAbs: number
  positiveLadderSkipRangeFraction: number
  pairProbeOffsetW: number
  signCrossMarchW: number
  centerSanityMaxDistW: number
  ladderMaxIters: number
  orbitDistW: number
  heightBandSlack: number
  logResidualMax: number
  logResidualMaxDistW: number
  halfStepW: number
  outsideClusterDistW: number
  bareTailFrac: number
  postJumpCapScale: number
  postJumpCapBias: number
  sqrtSnipeMinAlt: number
  sqrtSnipeNearZoneExtra: number
  gallopStepW: number
  gallopStopW: number
  pinpointRounds: number
  pinpointFinalRadius: number
  pinpointFinalRadiusWide: number
  clusterReachW: number
  clusterStepW: number
}

/** Default ladder_snipe constants (matches C++ LadderSnipeTuning defaults). */
export const DEFAULT_LADDER_SNIPE_TUNING: LadderSnipeTuning = {
  farTailAnchorMaxAbs: 200,
  ladderEntryMaxAbs: 6000,
  positiveLadderSkipRangeFraction: 0,
  pairProbeOffsetW: 0.25,
  signCrossMarchW: 1.5,
  centerSanityMaxDistW: 30,
  ladderMaxIters: 8,
  orbitDistW: 1,
  heightBandSlack: 150,
  logResidualMax: 0.1,
  logResidualMaxDistW: 3,
  halfStepW: 1.5,
  outsideClusterDistW: 2,
  bareTailFrac: 0.01,
  postJumpCapScale: 0.3,
  postJumpCapBias: 0.9,
  sqrtSnipeMinAlt: 7600,
  sqrtSnipeNearZoneExtra: 0.002,
  gallopStepW: 1.5,
  gallopStopW: 0.1,
  pinpointRounds: 5,
  pinpointFinalRadius: 8,
  pinpointFinalRadiusWide: 20,
  clusterReachW: 28,
  clusterStepW: 1.2,
}

/**
 * GA-tuned diff-60 constants from bench/koth/koth_tune/ladder_snipe.diff60.best.json.
 *
 * Regenerated with `koth_tune` after the solver gained the pair-derived centre, the model-verified
 * near-peak candidates and the rank-verified jump, because those changed what the ladder spends
 * guesses on (`positiveLadderSkipRangeFraction` 0.737 -> 0). The tuner now anneals its mutation step,
 * seeds the population from the loaded genome and finishes with a pattern search, and the run that
 * produced these values scored the fitness on 10 000 assignments with `--max-penalty 20
 * --tail-penalty 2` so that the 15+ guess assignments count, not just the total:
 *
 *   seed 1265595496 / 100 000: 5.64 -> 5.61 mean, worst 32 -> 30
 *   seed 4242       / 100 000: 5.65 -> 5.62 mean, worst 38 -> 35
 *   seed 789123     / 100 000: 5.64 -> 5.61 mean, worst 33 -> 31
 *
 * Regenerate (from the current file, which is faster than from scratch):
 *   koth_tune --load ladder_snipe.diff60.best.json --count 10000 --generations 100 \
 *     --sigma0 0.12 --anneal 60 --max-penalty 20 --tail-penalty 2
 */
export const TUNED_LADDER_SNIPE_DIFF60: LadderSnipeTuning = {
  farTailAnchorMaxAbs: 1415.65,
  ladderEntryMaxAbs: 8190.44,
  positiveLadderSkipRangeFraction: 0,
  pairProbeOffsetW: 0.157565,
  signCrossMarchW: 1.30017,
  centerSanityMaxDistW: 43.4416,
  ladderMaxIters: 5,
  orbitDistW: 0.309709,
  heightBandSlack: 400,
  logResidualMax: 0.35,
  logResidualMaxDistW: 1,
  halfStepW: 2.28062,
  outsideClusterDistW: 0.564256,
  bareTailFrac: 0.00259982,
  postJumpCapScale: 0.102336,
  postJumpCapBias: 1.42592,
  sqrtSnipeMinAlt: 7581.78,
  sqrtSnipeNearZoneExtra: 0.000201577,
  gallopStepW: 2.32097,
  gallopStopW: 0.204581,
  pinpointRounds: 5,
  pinpointFinalRadius: 8,
  pinpointFinalRadiusWide: 20,
  clusterReachW: 26.9526,
  clusterStepW: 1.72161,
}
