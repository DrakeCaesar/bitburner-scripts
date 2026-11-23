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
  /** Multiplier on the coarse scan pitch `(hills - 1) * 3w * 0.9 * 0.98`. */
  scanPitchScale: number
  /** Pair offset used by crest(), the local inversion the walk runs on. */
  crestPairOffsetW: number
  /** Second crest pair sits at `offset * this`, and only when the move clears crested by a margin. */
  crestRerunScale: number
  crestRerunMargin: number
  /** After a successful pinpoint inversion the pair offset is capped to this many widths. */
  pinpointPairOffsetCapW: number
  /** Divisor applied to the pinpoint pair offset when an inversion does not move the centre. */
  pinpointOffsetShrink: number
  /** Hop budget of the generic walk. */
  walkMaxHops: number
  /** Absolute altitude gain a hop must clear to count as progress. */
  walkImproveEps: number
  /** Pitch of the final full-range sweep that runs only if everything else failed. */
  backstopStepW: number
  /** Integer radius of the pinpoint that follows the backstop sweep. */
  backstopFinalRadius: number
  /** A pair whose inversion lands further than this from its anchor was not a single-hill read. */
  pairMaxDistW: number
  /** Below this the pair sits in a tail or gap, where the derived height is a coincidence. */
  pairMinReading: number
  /** 0 disables the left-tail hunt (leftTailHunt.ts) and runs the ladder alone. Default on. */
  leftTailHunt?: number
  /** Hunt: where the first clean window starts in the initial c0 range, as a fraction of its slack. */
  huntFirstWindowFraction?: number
  /** Hunt: on a coverage tie take the leftmost placement (1, default) or the rightmost (0). */
  huntPreferLeft?: number
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
  scanPitchScale: 1,
  crestPairOffsetW: 0.5,
  crestRerunScale: 0.5,
  crestRerunMargin: 1.02,
  pinpointPairOffsetCapW: 0.25,
  pinpointOffsetShrink: 4,
  walkMaxHops: 10,
  walkImproveEps: 1,
  backstopStepW: 0.7,
  backstopFinalRadius: 30,
  pairMaxDistW: 0.7,
  pairMinReading: 1000,
}

/**
 * Tuned diff-60 constants, mirrored in bench/koth/koth_tune/ladder_snipe.diff60.best.json.
 *
 * These tune the LADDER, which since the left-tail hunt (leftTailHunt.ts) only runs as its fallback;
 * the numbers below are the ladder alone (`leftTailHunt: 0`), which is also all the C++ tuner knows.
 *
 * Every heuristic constant the solver has is a gene, so the tuner decides what matters; only the
 * generator's own structure (peak height, rung, hill spacing, near zone) is fixed. The current values
 * came from a `koth_tune --generations 0 --refine 6` pattern search started from the previous genome
 * and scored with `--max-penalty 20 --tail-penalty 2 --count 30000`, plus a hand sweep of
 * `logResidualMaxDistW` (it had come out on its range floor) at 100 000 assignments:
 *
 *   seed 1265595496 / 100 000: 5.607 -> 5.568 mean, worst 30 -> 29, 15+ 389 -> 217, 20+ 16 -> 11
 *   seed 4242       / 100 000: 5.623 -> 5.574 mean, worst 35 -> 32, 15+ 443 -> 240
 *   seed 789123     / 100 000: 5.611 -> 5.574 mean, worst 31 -> 38, 15+ 436 -> 229
 *
 * Regenerate (from the current file, which is faster than from scratch):
 *   koth_tune --load ladder_snipe.diff60.best.json --count 30000 --generations 0 --refine 6 \
 *     --cap 60 --max-penalty 20 --tail-penalty 2
 */
export const TUNED_LADDER_SNIPE_DIFF60: LadderSnipeTuning = {
  farTailAnchorMaxAbs: 1397.73,
  ladderEntryMaxAbs: 7789.22,
  positiveLadderSkipRangeFraction: 0,
  pairProbeOffsetW: 0.129714,
  signCrossMarchW: 1.49835,
  centerSanityMaxDistW: 38.7621,
  ladderMaxIters: 4,
  orbitDistW: 0.275622,
  heightBandSlack: 397.113,
  logResidualMax: 0.348804,
  logResidualMaxDistW: 0.8,
  halfStepW: 2.23902,
  outsideClusterDistW: 0.307367,
  bareTailFrac: 0.0127675,
  postJumpCapScale: 0.146349,
  postJumpCapBias: 1.43113,
  sqrtSnipeMinAlt: 7541.72,
  sqrtSnipeNearZoneExtra: 0.00506673,
  gallopStepW: 2.37979,
  gallopStopW: 0.217224,
  pinpointRounds: 5,
  pinpointFinalRadius: 8,
  pinpointFinalRadiusWide: 20,
  clusterReachW: 30.2564,
  clusterStepW: 1.49751,
  scanPitchScale: 1.13765,
  crestPairOffsetW: 0.71364,
  crestRerunScale: 0.536742,
  crestRerunMargin: 1.03681,
  pinpointPairOffsetCapW: 0.395693,
  pinpointOffsetShrink: 9.95425,
  walkMaxHops: 12,
  walkImproveEps: 12.2356,
  backstopStepW: 0.871275,
  backstopFinalRadius: 25,
  pairMaxDistW: 0.611808,
  pairMinReading: 1357.75,
}
