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
 * GA-tuned diff-60 constants from tests/koth_tune/ladder_snipe.diff60.best.json.
 * Regenerate when koth_tune produces a new best file.
 */
export const TUNED_LADDER_SNIPE_DIFF60: LadderSnipeTuning = {
  farTailAnchorMaxAbs: 397.16,
  ladderEntryMaxAbs: 7418.48,
  positiveLadderSkipRangeFraction: 0.737109,
  pairProbeOffsetW: 0.154316,
  signCrossMarchW: 1.0245,
  centerSanityMaxDistW: 38.425,
  ladderMaxIters: 8,
  orbitDistW: 0.5,
  heightBandSlack: 272.627,
  logResidualMax: 0.271547,
  logResidualMaxDistW: 1,
  halfStepW: 1.93344,
  outsideClusterDistW: 1,
  bareTailFrac: 0.021817,
  postJumpCapScale: 0.224271,
  postJumpCapBias: 0.911711,
  sqrtSnipeMinAlt: 7555.23,
  sqrtSnipeNearZoneExtra: 0.00250204,
  gallopStepW: 1.93321,
  gallopStopW: 0.185353,
  pinpointRounds: 5,
  pinpointFinalRadius: 8,
  pinpointFinalRadiusWide: 20,
  clusterReachW: 31.1991,
  clusterStepW: 1.79502,
}
