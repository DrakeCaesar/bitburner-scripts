import { NS } from "@ns"
import { purchaseAugmentations } from "./libraries/augmentations.js"

/**
 * Standalone script to purchase augmentations
 * Usage:
 *   run buyAugments.js              - Purchase all affordable augmentations
 *   run buyAugments.js flux         - Purchase augmentations + top up with NeuroFlux
 *   run buyAugments.js dryrun       - Show what would be purchased without buying
 *   run buyAugments.js flux dryrun  - Show purchases + NeuroFlux (dry run)
 */
export async function main(ns: NS) {
  const args = ns.args.map((arg) => String(arg).toLowerCase())
  const buyFlux = args.includes("flux")
  const dryRun = args.includes("dryrun") || args.includes("dry")
  await purchaseAugmentations(ns, buyFlux, dryRun)
}
