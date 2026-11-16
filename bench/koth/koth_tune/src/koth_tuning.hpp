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
};

const LadderSnipeTuning& defaultLadderSnipeTuning();

/** Active tuning for the current thread (GA workers set this during evaluation). */
const LadderSnipeTuning& activeLadderSnipeTuning();
void setActiveLadderSnipeTuning(const LadderSnipeTuning* tuning);

}  // namespace koth
