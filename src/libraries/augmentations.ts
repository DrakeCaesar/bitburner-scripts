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

  // Get player stats
  const playerMoney = ns.getPlayer().money
  const factionReps = new Map<string, number>()
  for (const faction of playerFactions) {
    factionReps.set(faction, ns.singularity.getFactionRep(faction))
  }

  // Filter out owned augmentations and check rep requirements
  const potentiallyAffordable: AugmentInfo[] = []
  const unaffordable: AugmentInfo[] = []

  for (const aug of augmentMap.values()) {
    // Skip owned augmentations entirely
    if (aug.owned) continue

    // Check if we have enough rep in ANY of the factions that offer this augment
    const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)

    if (hasEnoughRep) {
      potentiallyAffordable.push(aug)
    } else {
      unaffordable.push(aug)
    }
  }

  // Topological sort optimized for minimum total cost
  // Strategy: Buy expensive augments first (to minimize 1.9x price inflation),
  // but ensure prerequisites are purchased before their dependents
  function topologicalSort(augs: AugmentInfo[]): AugmentInfo[] {
    const augsByName = new Map(augs.map((aug) => [aug.name, aug]))
    const visited = new Set<string>()
    const result: AugmentInfo[] = []

    // Build dependency graph: for each aug, track what depends on it
    const dependents = new Map<string, Set<string>>()
    const prereqCount = new Map<string, number>()

    for (const aug of augs) {
      prereqCount.set(aug.name, aug.prereqs.filter((p) => augsByName.has(p)).length)

      for (const prereqName of aug.prereqs) {
        if (augsByName.has(prereqName)) {
          if (!dependents.has(prereqName)) {
            dependents.set(prereqName, new Set())
          }
          dependents.get(prereqName)!.add(aug.name)
        }
      }
    }

    // Process augments by price (most expensive first), respecting dependencies
    while (result.length < augs.length) {
      // Find all augments with no remaining prerequisites
      const available = augs.filter((aug) => !visited.has(aug.name) && (prereqCount.get(aug.name) ?? 0) === 0)

      if (available.length === 0) break // Circular dependency or error

      // Among available augments, pick the most expensive one
      const next = available.reduce((max, aug) => (aug.price > max.price ? aug : max))

      visited.add(next.name)
      result.push(next)

      // Update prereq counts for dependents
      const deps = dependents.get(next.name)
      if (deps) {
        for (const depName of deps) {
          prereqCount.set(depName, (prereqCount.get(depName) ?? 0) - 1)
        }
      }
    }

    return result
  }

  // Sort all potentially affordable augments for optimal purchase order (expensive first, respecting prereqs)
  const optimallySorted = topologicalSort(potentiallyAffordable)

  // Now split into truly affordable (based on cumulative adjusted cost) and too expensive
  const AUGMENT_PRICE_MULT = 1.9
  let cumulativeCost = 0
  const affordable: AugmentInfo[] = []
  const tooExpensiveCumulative: AugmentInfo[] = []

  for (let i = 0; i < optimallySorted.length; i++) {
    const adjustedPrice = optimallySorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    if (cumulativeCost <= playerMoney) {
      affordable.push(optimallySorted[i])
    } else {
      // This and all subsequent augments are unaffordable due to cumulative cost
      tooExpensiveCumulative.push(...optimallySorted.slice(i))
      break
    }
  }

  // Sort unaffordable by price (most expensive first)
  unaffordable.sort((a, b) => b.price - a.price)

  const affordableSorted = affordable
  const allAugs = [...affordableSorted, ...tooExpensiveCumulative, ...unaffordable]

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
    ns.tprint("I am not in any factions yet.")
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

  const AUGMENT_PRICE_MULT = 1.9

  // Calculate total cost for display (affordableSorted already contains the correct augments)
  let totalCost = 0
  for (let i = 0; i < affordableSorted.length; i++) {
    totalCost += affordableSorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
  }

  // Purchase augmentations
  if (affordableSorted.length > 0) {
    ns.tprint(`Purchasing ${affordableSorted.length} augmentations (total cost: ${ns.formatNumber(totalCost)})`)

    for (let i = 0; i < affordableSorted.length; i++) {
      const aug = affordableSorted[i]
      const adjustedPrice = aug.price * Math.pow(AUGMENT_PRICE_MULT, i)
      const validFaction = aug.factions.find((f) => (factionReps.get(f) ?? 0) >= aug.repReq)

      if (!validFaction) {
        ns.tprint(`No valid faction found for: ${aug.name}`)
        continue
      }

      if (dryRun) {
        ns.tprint(`Would purchase: ${aug.name} from ${validFaction} for ${ns.formatNumber(adjustedPrice)}`)
        purchaseCount++
        totalSpent += adjustedPrice
      } else {
        const success = ns.singularity.purchaseAugmentation(validFaction, aug.name)
        if (success) {
          ns.tprint(`Purchased: ${aug.name} from ${validFaction} for ${ns.formatNumber(adjustedPrice)}`)
          purchaseCount++
          totalSpent += adjustedPrice
        } else {
          ns.tprint(`Failed to purchase: ${aug.name} from ${validFaction}`)
        }
      }
    }
  } else {
    ns.tprint(`No augmentations are currently affordable.`)
  }

  // If buyFlux is true, top up with NeuroFlux Governor
  if (buyFlux && neuroFluxInfo) {
    const NEUROFLUX_PRICE_MULT = 1.14 * 1.9 // 2.38 - NeuroFlux base price escalation
    const NEUROFLUX_REP_MULT = 1.14 // NeuroFlux rep requirement escalation

    const remainingMoney = dryRun ? ns.getPlayer().money - totalSpent : ns.getPlayer().money
    let currentRepReq = neuroFluxInfo.repReq
    const validFaction = neuroFluxInfo.factions.find((f) => (factionReps.get(f) ?? 0) >= currentRepReq)

    if (!validFaction) {
      ns.tprint(`No valid faction found for: ${neuroFluxInfo.name}`)
    } else {
      const positionOffset = affordableSorted.length
      let currentBasePrice = neuroFluxInfo.price
      let currentPrice = currentBasePrice * Math.pow(AUGMENT_PRICE_MULT, positionOffset)
      let currentMoney = remainingMoney
      let neuroFluxIndex = 0
      const maxFactionRep = Math.max(...neuroFluxInfo.factions.map((f) => factionReps.get(f) ?? 0))

      while (currentMoney >= currentPrice && maxFactionRep >= currentRepReq) {
        if (dryRun) {
          ns.tprint(`Would purchase: ${neuroFluxInfo.name} from ${validFaction} for ${ns.formatNumber(currentPrice)} (base: ${ns.formatNumber(currentBasePrice)}, rep: ${ns.formatNumber(currentRepReq)})`)
          purchaseCount++
          totalSpent += currentPrice
          currentMoney -= currentPrice
          currentBasePrice *= NEUROFLUX_PRICE_MULT
          currentPrice = currentBasePrice * Math.pow(AUGMENT_PRICE_MULT, positionOffset + neuroFluxIndex + 1)
          currentRepReq *= NEUROFLUX_REP_MULT
          neuroFluxIndex++
        } else {
          const success = ns.singularity.purchaseAugmentation(validFaction, neuroFluxInfo.name)
          if (success) {
            ns.tprint(`Purchased: ${neuroFluxInfo.name} from ${validFaction} for ${ns.formatNumber(currentPrice)} (base: ${ns.formatNumber(currentBasePrice)}, rep: ${ns.formatNumber(currentRepReq)})`)
            purchaseCount++
            totalSpent += currentPrice
            currentMoney -= currentPrice
            currentBasePrice *= NEUROFLUX_PRICE_MULT
            currentPrice = currentBasePrice * Math.pow(AUGMENT_PRICE_MULT, positionOffset + neuroFluxIndex + 1)
            currentRepReq *= NEUROFLUX_REP_MULT
            neuroFluxIndex++
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
