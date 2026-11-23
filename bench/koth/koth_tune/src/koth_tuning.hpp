#pragma once

namespace koth {

/**
 * Heuristic knobs for the ladder / ladder_snipe solver path.
 * Generator-derived values (10000, 2600, 3w spacing, 0.03 near zone) stay in koth_common.hpp.
 */
struct LadderSnipeTuning {
  // Coarse / ladder entry
  double farTailAnchorMaxAbs = 200.0;
  double ladderEntryMaxAbs = 6000.0;
  /** Skip ladder on positive coarse anchors when x > lo + fraction * (hi - lo). 0 = never skip. */
  double positiveLadderSkipRangeFraction = 0.0;

  // Pair inversion + climb
  double pairProbeOffsetW = 0.25;
  double signCrossMarchW = 1.5;
  double centerSanityMaxDistW = 30.0;
  int ladderMaxIters = 8;
  double orbitDistW = 1.0;

  // Trust / model checks
  double heightBandSlack = 150.0;
  double logResidualMax = 0.1;
  double logResidualMaxDistW = 3.0;
  double halfStepW = 1.5;
  double outsideClusterDistW = 2.0;
  double bareTailFrac = 0.01;
  double postJumpCapScale = 0.3;
  double postJumpCapBias = 0.9;

  // Sqrt snipe (near-zone finisher)
  double sqrtSnipeMinAlt = 7600.0;
  /** Added to KOTH_NEAR_ZONE_FRACTION for the sqrt snipe distance cap. */
  double sqrtSnipeNearZoneExtra = 0.002;

  // Generic walk / recovery (ladder_snipe post-pipeline)
  double gallopStepW = 1.5;
  double gallopStopW = 0.1;
  int pinpointRounds = 5;
  int pinpointFinalRadius = 8;
  int pinpointFinalRadiusWide = 20;
  double clusterReachW = 28.0;
  double clusterStepW = 1.2;

  // Coarse scan / generic walk plumbing
  /** Multiplier on the coarse scan pitch (hills - 1) * 3w * 0.9 * 0.98. */
  double scanPitchScale = 1.0;
  /** Pair offset used by crest(), the local inversion the walk runs on. */
  double crestPairOffsetW = 0.5;
  /** Second crest pair sits at offset * this. */
  double crestRerunScale = 0.5;
  /** The second crest pair is only taken when the move clears the crested altitude by this factor. */
  double crestRerunMargin = 1.02;
  /** After a successful pinpoint inversion the pair offset is capped to this many widths. */
  double pinpointPairOffsetCapW = 0.25;
  /** Divisor applied to the pinpoint pair offset when an inversion does not move the centre. */
  double pinpointOffsetShrink = 4.0;
  /** Hop budget of the generic walk. */
  int walkMaxHops = 10;
  /** Absolute altitude gain a hop must clear to count as progress. */
  double walkImproveEps = 1.0;
  /** Pitch of the final full-range sweep that runs only if everything else failed. */
  double backstopStepW = 0.7;
  /** Integer radius of the pinpoint that follows the backstop sweep. */
  int backstopFinalRadius = 30;
  /** A pair whose inversion lands further than this from its anchor was not a single-hill read. */
  double pairMaxDistW = 0.7;
  /** Below this the pair sits in a tail or gap, where the derived height is a coincidence. */
  double pairMinReading = 1000.0;
};

const LadderSnipeTuning& defaultLadderSnipeTuning();

/** Active tuning for the current thread (GA workers set this during evaluation). */
const LadderSnipeTuning& activeLadderSnipeTuning();
void setActiveLadderSnipeTuning(const LadderSnipeTuning* tuning);

}  // namespace koth
