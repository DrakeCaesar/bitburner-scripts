import type { NS } from "@ns"
import { getPreferredFactionForInfiltrationRep } from "../factionWork.js"
import { isInfiltrationMoneyMode, type InfiltrationRewardGoal } from "./infiltrationTargets.js"

/**
 * Infiltration reward order:
 * 1. Pre-favor augment rep, then cash for that augment (repeat lowest rep req first)
 * 2. Donation favor rep (factions with unowned post-favor augments only)
 * 3. Post-favor augment rep, then cash for that augment (repeat lowest rep req first)
 * 4. NeuroFlux Governor rep, then cash for the next level
 *
 * When grinding rep and favor is at the donation threshold (e.g. 150), sell cash and donate
 * may beat trading rep directly; target selection and victory collection pick the faster path.
 */
export function getInfiltrationRewardGoal(ns: NS): InfiltrationRewardGoal {
  if (isInfiltrationMoneyMode(ns)) return "money"
  return getPreferredFactionForInfiltrationRep(ns) != null ? "reputation" : "money"
}
