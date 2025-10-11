import { NS } from "@ns"
import { purchaseAugmentations } from "./libraries/augmentations.js"

/**
 * Standalone script to purchase augmentations
 * Usage:
 *   run buyAugments.js         - Purchase all affordable augmentations
 *   run buyAugments.js flux    - Purchase augmentations + top up with NeuroFlux
 */
export async function main(ns: NS) {
  const buyFlux = ns.args[0] === "flux"
  await purchaseAugmentations(ns, buyFlux)
}
