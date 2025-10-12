import { NS } from "@ns"

/**
 * Augmentations Library
 * Handles augmentation data fetching and purchasing logic
 * Separated from DOM manipulation for better reusability
 */

export interface AugmentInfo {
  name: string
  factions: string[] // All factions that offer this augment
  price: number
  repReq: number
  owned: boolean
  prereqs: string[] // Prerequisites for this augment
}

export interface AugmentData {
  affordableSorted: AugmentInfo[]
  tooExpensiveCumulative: AugmentInfo[]
  unaffordable: AugmentInfo[]
  allAugs: AugmentInfo[]
  neuroFluxInfo: AugmentInfo | null
  factionReps: Map<string, number>
  playerMoney: number
}

/**
 * Collect and organize augmentation data from all player factions
 */
export function getAugmentData(ns: NS, playerFactions: string[]): AugmentData {
  const augmentMap = new Map<string, AugmentInfo>()
  let neuroFluxInfo: AugmentInfo | null = null

  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)

    for (const augName of augments) {
      const price = ns.singularity.getAugmentationPrice(augName)
      const repReq = ns.singularity.getAugmentationRepReq(augName)
      const owned = ns.singularity.getOwnedAugmentations(true).includes(augName)
      const prereqs = ns.singularity.getAugmentationPrereq(augName)

      // Handle NeuroFlux Governor separately
      if (augName.startsWith("NeuroFlux Governor")) {
        if (!neuroFluxInfo) {
          neuroFluxInfo = {
            name: augName,
            factions: [faction],
            price: price,
            repReq: repReq,
            owned: owned,
            prereqs: prereqs,
          }
        } else {
          neuroFluxInfo.factions.push(faction)
        }
        continue
      }

      if (augmentMap.has(augName)) {
        augmentMap.get(augName)!.factions.push(faction)
      } else {
        augmentMap.set(augName, {
          name: augName,
          factions: [faction],
          price: price,
          repReq: repReq,
          owned: owned,
          prereqs: prereqs,
        })
      }
    }
  }

  // Get all augments as array and sort by price
  const allAugs = Array.from(augmentMap.values()).sort((a, b) => a.price - b.price)

  // Get faction reputations
  const factionReps = new Map<string, number>()
  for (const faction of playerFactions) {
    factionReps.set(faction, ns.singularity.getFactionRep(faction))
  }

  const playerMoney = ns.getPlayer().money

  // Find max reputation the player has across all factions (for a given augment's factions)
  function getMaxRepForAugment(aug: AugmentInfo): number {
    return Math.max(...aug.factions.map((f) => factionReps.get(f) ?? 0))
  }

  // Check if all prerequisites are owned
  function hasAllPrereqs(aug: AugmentInfo): boolean {
    return aug.prereqs.every((prereqName) => {
      const prereq = augmentMap.get(prereqName)
      return prereq?.owned ?? false
    })
  }

  const AUGMENT_PRICE_MULT = 1.9

  // Categorize augmentations
  const affordable: AugmentInfo[] = []
  const tooExpensiveCumulative: AugmentInfo[] = []
  const unaffordable: AugmentInfo[] = []

  let cumulativeCost = 0

  for (let i = 0; i < allAugs.length; i++) {
    const aug = allAugs[i]

    // Skip already owned augmentations
    if (aug.owned) {
      continue
    }

    const adjustedPrice = aug.price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    const maxFactionRep = getMaxRepForAugment(aug)
    const hasRep = maxFactionRep >= aug.repReq
    const hasPrereqs = hasAllPrereqs(aug)

    // Check affordability and prerequisites
    if (hasRep && hasPrereqs) {
      if (cumulativeCost <= playerMoney) {
        affordable.push(aug)
      } else {
        tooExpensiveCumulative.push(aug)
      }
    } else {
      unaffordable.push(aug)
    }
  }

  // Sort affordable by price (already sorted from parent array)
  const affordableSorted = affordable

  return {
    affordableSorted,
    tooExpensiveCumulative,
    unaffordable,
    allAugs,
    neuroFluxInfo,
    factionReps,
    playerMoney,
  }
}

/**
 * Purchase augmentations in optimal order
 * @param buyFlux If true, top up remaining money with NeuroFlux Governor
 * @param dryRun If true, only show what would be purchased without actually buying
 */
export async function purchaseAugmentations(ns: NS, buyFlux: boolean, dryRun = false): Promise<void> {
  const player = ns.getPlayer()
  const playerFactions = player.factions

  if (playerFactions.length === 0) {
    ns.tprint("You are not in any factions yet.")
    return
  }

  let { affordableSorted, neuroFluxInfo, factionReps, playerMoney } = getAugmentData(ns, playerFactions)

  ns.tprint("\n" + "=".repeat(120))
  ns.tprint(
    dryRun
      ? buyFlux
        ? "[DRY RUN] WOULD PURCHASE AUGMENTATIONS + TOP UP WITH NEUROFLUX"
        : "[DRY RUN] WOULD PURCHASE AUGMENTATIONS (optimal order, within budget)"
      : buyFlux
        ? "PURCHASING AUGMENTATIONS + TOPPING UP WITH NEUROFLUX"
        : "PURCHASING AUGMENTATIONS (optimal order, within budget)"
  )
  ns.tprint("=".repeat(120))

  let purchaseCount = 0
  let totalSpent = 0

  // Calculate cumulative costs to determine affordability
  const AUGMENT_PRICE_MULT = 1.9
  let cumulativeCost = 0
  const affordableWithBudget: typeof affordableSorted = []

  for (let i = 0; i < affordableSorted.length; i++) {
    const adjustedPrice = affordableSorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    if (cumulativeCost <= playerMoney) {
      affordableWithBudget.push(affordableSorted[i])
    } else {
      break
    }
  }

  // Purchase augmentations we can actually afford
  if (affordableWithBudget.length > 0) {
    ns.tprint(
      `Can afford ${affordableWithBudget.length} of ${affordableSorted.length} augmentations (total cost: ${ns.formatNumber(cumulativeCost > playerMoney ? playerMoney : cumulativeCost)})`
    )

    for (const aug of affordableWithBudget) {
      const validFaction = aug.factions.find((f) => (factionReps.get(f) ?? 0) >= aug.repReq)

      if (!validFaction) {
        ns.tprint(`No valid faction found for: ${aug.name}`)
        continue
      }

      if (dryRun) {
        ns.tprint(`Would purchase: ${aug.name} from ${validFaction} for ${ns.formatNumber(aug.price)}`)
        purchaseCount++
        totalSpent += aug.price
      } else {
        const success = ns.singularity.purchaseAugmentation(validFaction, aug.name)
        if (success) {
          ns.tprint(`Purchased: ${aug.name} from ${validFaction} for ${ns.formatNumber(aug.price)}`)
          purchaseCount++
          totalSpent += aug.price
        } else {
          ns.tprint(`Failed to purchase: ${aug.name} from ${validFaction}`)
        }
      }
    }
  } else if (affordableSorted.length > 0) {
    ns.tprint(
      `Cannot afford any augmentations. Cheapest would cost ${ns.formatNumber(affordableSorted[0].price)}, you have ${ns.formatNumber(playerMoney)}`
    )
  }

  // If buyFlux is true, top up with NeuroFlux Governor
  if (buyFlux && neuroFluxInfo) {
    const remainingMoney = dryRun ? ns.getPlayer().money - totalSpent : ns.getPlayer().money
    const validFaction = neuroFluxInfo.factions.find((f) => (factionReps.get(f) ?? 0) >= neuroFluxInfo.repReq)

    if (!validFaction) {
      ns.tprint(`No valid faction found for: ${neuroFluxInfo.name}`)
    } else {
      let currentPrice = neuroFluxInfo.price
      let currentMoney = remainingMoney

      while (currentMoney >= currentPrice) {
        if (dryRun) {
          ns.tprint(`Would purchase: ${neuroFluxInfo.name} from ${validFaction} for ${ns.formatNumber(currentPrice)}`)
          purchaseCount++
          totalSpent += currentPrice
          currentMoney -= currentPrice
          currentPrice *= AUGMENT_PRICE_MULT
        } else {
          const success = ns.singularity.purchaseAugmentation(validFaction, neuroFluxInfo.name)
          if (success) {
            ns.tprint(`Purchased: ${neuroFluxInfo.name} from ${validFaction} for ${ns.formatNumber(currentPrice)}`)
            purchaseCount++
            totalSpent += currentPrice
            currentMoney -= currentPrice
            currentPrice *= AUGMENT_PRICE_MULT
          } else {
            ns.tprint(`Failed to purchase: ${neuroFluxInfo.name} from ${validFaction}`)
            break
          }
        }
      }
    }
  }

  ns.tprint("=".repeat(120))
  ns.tprint(
    dryRun
      ? `Would purchase ${purchaseCount} augmentations for ${ns.formatNumber(totalSpent)}`
      : `Purchased ${purchaseCount} augmentations for ${ns.formatNumber(totalSpent)}`
  )
  ns.tprint("=".repeat(120))

  if (purchaseCount > 0 && !dryRun) {
    const installNow = await ns.prompt("Install augmentations now and restart?")
    if (installNow) {
      ns.singularity.installAugmentations("/batch.js")
    }
  }
}
