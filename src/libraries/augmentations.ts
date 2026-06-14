import { FactionName, NS } from "@ns"

/**
 * Augmentations Library
 * Handles augmentation data fetching and purchasing logic
 * Separated from DOM manipulation for better reusability
 */

export interface AugmentInfo {
  name: string
  factions: FactionName[] // All factions that offer this augment
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

export const AUGMENT_QUEUE_PRICE_MULT = 1.9
export const NEUROFLUX_LEVEL_MULT = 1.14
export const NEUROFLUX_PRICE_STEP_MULT = NEUROFLUX_LEVEL_MULT * AUGMENT_QUEUE_PRICE_MULT

/** SoA uses separate price/rep multipliers that do not reset on install — skip in buy/dashboard planners. */
export const AUGMENT_PURCHASE_EXCLUDED_FACTIONS: ReadonlySet<FactionName> = new Set([
  "Shadows of Anarchy" as FactionName,
])

export function isAugmentPurchaseExcludedFaction(faction: FactionName): boolean {
  return AUGMENT_PURCHASE_EXCLUDED_FACTIONS.has(faction)
}

export function filterAugmentPurchaseFactions(factions: readonly FactionName[]): FactionName[] {
  return factions.filter((faction) => !isAugmentPurchaseExcludedFaction(faction))
}

/** Static augmentation metadata from the game (cached for the script lifetime). */
export type AugmentStats = Record<string, number>

export interface AugmentCatalogEntry {
  name: string
  factions: FactionName[]
  basePrice: number
  repReq: number
  prereqs: string[]
  stats: AugmentStats
}

let augmentCatalog: Map<string, AugmentCatalogEntry> | null = null
let augmentsByFaction: Map<FactionName, string[]> | null = null

function buildAugmentsByFaction(catalog: Map<string, AugmentCatalogEntry>): Map<FactionName, string[]> {
  const byFaction = new Map<FactionName, string[]>()
  for (const entry of catalog.values()) {
    for (const faction of entry.factions) {
      const list = byFaction.get(faction)
      if (list) list.push(entry.name)
      else byFaction.set(faction, [entry.name])
    }
  }
  return byFaction
}

/**
 * All augmentations in the game, built once on first use.
 * Static fields are cached; use getAugmentationPrice for current price (and NF rep after purchases).
 */
export function getAugmentCatalog(ns: NS): ReadonlyMap<string, AugmentCatalogEntry> {
  if (augmentCatalog) return augmentCatalog

  augmentCatalog = new Map()
  const allFactions = Object.values(ns.enums.FactionName) as FactionName[]

  for (const faction of allFactions) {
    let augments: string[]
    try {
      augments = ns.singularity.getAugmentationsFromFaction(faction)
    } catch {
      continue
    }

    for (const augName of augments) {
      const existing = augmentCatalog.get(augName)
      if (existing) {
        if (!existing.factions.includes(faction)) {
          existing.factions.push(faction)
        }
        continue
      }

      augmentCatalog.set(augName, {
        name: augName,
        factions: [faction],
        basePrice: ns.singularity.getAugmentationBasePrice(augName),
        repReq: ns.singularity.getAugmentationRepReq(augName),
        prereqs: ns.singularity.getAugmentationPrereq(augName),
        stats: ns.singularity.getAugmentationStats(augName) as unknown as AugmentStats,
      })
    }
  }

  augmentsByFaction = buildAugmentsByFaction(augmentCatalog)
  return augmentCatalog
}

export function isNeuroFluxAugment(name: string): boolean {
  return name.startsWith("NeuroFlux Governor")
}

export function getOwnedAugmentationNames(ns: NS): Set<string> {
  return new Set(ns.singularity.getOwnedAugmentations(true))
}

/** Augment names sold by a faction (from catalog). */
export function getAugmentNamesFromFaction(ns: NS, faction: FactionName): readonly string[] {
  getAugmentCatalog(ns)
  return augmentsByFaction?.get(faction) ?? []
}

export function getAugmentCatalogEntry(ns: NS, augName: string): AugmentCatalogEntry | undefined {
  return getAugmentCatalog(ns).get(augName)
}

/** True when every non-NeuroFlux augment from this faction is owned or queued. */
export function factionAugmentsOwned(ns: NS, faction: FactionName): boolean {
  const owned = getOwnedAugmentationNames(ns)
  for (const augName of getAugmentNamesFromFaction(ns, faction)) {
    if (isNeuroFluxAugment(augName)) continue
    if (!owned.has(augName)) return false
  }
  return true
}

interface PurchaseGraph {
  augsByName: Map<string, AugmentInfo>
  dependents: Map<string, string[]>
  effectiveSortPrice(name: string): number
}

function buildPurchaseGraph(augs: AugmentInfo[]): PurchaseGraph {
  const augsByName = new Map(augs.map((aug) => [aug.name, aug]))
  const dependents = new Map<string, string[]>()

  for (const aug of augs) {
    for (const prereqName of aug.prereqs) {
      if (!augsByName.has(prereqName)) continue
      const list = dependents.get(prereqName)
      if (list) list.push(aug.name)
      else dependents.set(prereqName, [aug.name])
    }
  }

  const effectivePriceMemo = new Map<string, number>()
  function effectiveSortPrice(name: string): number {
    const cached = effectivePriceMemo.get(name)
    if (cached !== undefined) return cached
    const aug = augsByName.get(name)
    if (!aug) return 0
    let max = aug.price
    for (const depName of dependents.get(name) ?? []) {
      max = Math.max(max, effectiveSortPrice(depName))
    }
    effectivePriceMemo.set(name, max)
    return max
  }

  return { augsByName, dependents, effectiveSortPrice }
}

function inSetPrereqCount(aug: AugmentInfo, pool: Map<string, AugmentInfo>): number {
  return aug.prereqs.filter((p) => pool.has(p)).length
}

function pickNextByChainPrice(available: AugmentInfo[], graph: PurchaseGraph): AugmentInfo {
  return available.reduce((best, aug) =>
    graph.effectiveSortPrice(aug.name) > graph.effectiveSortPrice(best.name) ? aug : best
  )
}

/**
 * Purchase order: prerequisites before dependents, expensive-first by *chain* price.
 * A cheap prereq ranks at max(own price, dependents' prices) so pairs like
 * BrachiBlades + Graphene upgrade stay together and the upgrade does not land
 * in a late 1.9x queue slot.
 */
export function sortAugmentsForPurchase(augs: AugmentInfo[]): AugmentInfo[] {
  const graph = buildPurchaseGraph(augs)
  const prereqCount = new Map<string, number>()
  for (const aug of augs) {
    prereqCount.set(aug.name, inSetPrereqCount(aug, graph.augsByName))
  }

  const visited = new Set<string>()
  const result: AugmentInfo[] = []

  while (result.length < augs.length) {
    const available = augs.filter((aug) => !visited.has(aug.name) && (prereqCount.get(aug.name) ?? 0) === 0)
    if (available.length === 0) break

    const next = pickNextByChainPrice(available, graph)
    visited.add(next.name)
    result.push(next)

    for (const depName of graph.dependents.get(next.name) ?? []) {
      prereqCount.set(depName, (prereqCount.get(depName) ?? 0) - 1)
    }
  }

  return result
}

/**
 * Build a purchase plan using only augments that fit the current budget at each queue slot.
 * Rep-qualified augments that are too expensive are skipped (not queued ahead of cheaper buys).
 */
export function buildAffordablePurchasePlan(
  augs: AugmentInfo[],
  playerMoney: number
): { affordable: AugmentInfo[]; skippedHasRep: AugmentInfo[] } {
  const remaining = new Map(augs.map((aug) => [aug.name, aug]))
  const planned: AugmentInfo[] = []
  const plannedNames = new Set<string>()
  let budget = playerMoney

  while (remaining.size > 0) {
    const available = [...remaining.values()].filter((aug) =>
      aug.prereqs.every((p) => plannedNames.has(p) || !remaining.has(p))
    )
    if (available.length === 0) break

    const slot = planned.length
    const graph = buildPurchaseGraph([...remaining.values()])
    const affordableNow = available.filter((aug) => {
      const adjusted = aug.price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, slot)
      return adjusted <= budget
    })
    if (affordableNow.length === 0) break

    const next = pickNextByChainPrice(affordableNow, graph)
    const adjusted = next.price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, slot)
    planned.push(next)
    plannedNames.add(next.name)
    budget -= adjusted
    remaining.delete(next.name)
  }

  return { affordable: planned, skippedHasRep: [...remaining.values()] }
}

/** Money grind target at its ideal queue slot, ignoring opportunistic lower-rep greedy buys. */
export function getInfiltrationMoneyTargetPlan(
  repQualified: AugmentInfo[],
  playerMoney: number
): { aug: AugmentInfo; targetPrice: number; moneyNeeded: number } | null {
  const { affordable } = buildAffordablePurchasePlan(repQualified, playerMoney)
  const plannedNames = new Set(affordable.map((aug) => aug.name))
  const remaining = new Map(
    repQualified.filter((aug) => !plannedNames.has(aug.name)).map((aug) => [aug.name, aug])
  )
  if (remaining.size === 0) return null

  const available = [...remaining.values()].filter((aug) =>
    aug.prereqs.every((prereq) => plannedNames.has(prereq) || !remaining.has(prereq))
  )
  if (available.length === 0) return null

  const graph = buildPurchaseGraph([...remaining.values()])
  const target = pickNextByChainPrice(available, graph)

  // Greedy affordable buys below target rep are opportunistic and do not consume its slot.
  const canonical = affordable.filter((aug) => aug.repReq >= target.repReq)
  const slot = canonical.length
  const targetPrice = target.price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, slot)

  let budget = playerMoney
  for (let i = 0; i < canonical.length; i++) {
    budget -= canonical[i].price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, i)
  }

  if (budget >= targetPrice) return null

  return {
    aug: target,
    targetPrice,
    moneyNeeded: targetPrice - budget,
  }
}

/** Next rep-qualified augment the purchase plan cannot afford at its queue slot. */
export function getNextUnaffordablePlannedAugment(
  repQualified: AugmentInfo[],
  playerMoney: number
): { aug: AugmentInfo; targetPrice: number; moneyNeeded: number } | null {
  const { affordable } = buildAffordablePurchasePlan(repQualified, playerMoney)
  const slot = affordable.length
  const plannedNames = new Set(affordable.map((aug) => aug.name))
  const remaining = new Map(
    repQualified.filter((aug) => !plannedNames.has(aug.name)).map((aug) => [aug.name, aug])
  )
  if (remaining.size === 0) return null

  const available = [...remaining.values()].filter((aug) =>
    aug.prereqs.every((prereq) => plannedNames.has(prereq) || !remaining.has(prereq))
  )
  if (available.length === 0) return null

  const graph = buildPurchaseGraph([...remaining.values()])
  const next = pickNextByChainPrice(available, graph)
  const targetPrice = next.price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, slot)

  let budget = playerMoney
  for (let i = 0; i < affordable.length; i++) {
    budget -= affordable[i].price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, i)
  }

  if (budget >= targetPrice) return null

  return {
    aug: next,
    targetPrice,
    moneyNeeded: targetPrice - budget,
  }
}

/** Simulated NeuroFlux price/rep when regular augs are not actually queued (dry run / dashboard). */
export function neuroFluxPurchaseCost(
  neuroFluxInfo: AugmentInfo,
  regularAugmentsAhead: number,
  neuroFluxIndex: number
): { price: number; repReq: number } {
  return {
    price:
      neuroFluxInfo.price *
      Math.pow(AUGMENT_QUEUE_PRICE_MULT, regularAugmentsAhead) *
      Math.pow(NEUROFLUX_PRICE_STEP_MULT, neuroFluxIndex),
    repReq: neuroFluxInfo.repReq * Math.pow(NEUROFLUX_LEVEL_MULT, neuroFluxIndex),
  }
}

export type NeuroFluxGrindNeed = "rep" | "money"

export interface NextNeuroFluxLevel {
  levelIndex: number
  price: number
  repReq: number
  need: NeuroFluxGrindNeed
  faction: FactionName
  currentRep: number
  repGap: number
}

const MAX_NEUROFLUX_SIM_LEVELS = 1000

function bestNeuroFluxRepGrindFaction(
  neuroFluxInfo: AugmentInfo,
  factionReps: Map<string, number>,
  repReq: number,
  grindFactions: ReadonlySet<FactionName>
): { faction: FactionName; currentRep: number; repGap: number } | null {
  let best: { faction: FactionName; currentRep: number; repGap: number } | null = null

  for (const faction of neuroFluxInfo.factions) {
    if (!grindFactions.has(faction)) continue
    const currentRep = factionReps.get(faction) ?? 0
    if (currentRep >= repReq) continue
    const repGap = repReq - currentRep
    if (
      !best ||
      repGap < best.repGap ||
      (repGap === best.repGap && currentRep > best.currentRep)
    ) {
      best = { faction, currentRep, repGap }
    }
  }

  return best
}

function bestNeuroFluxTradeFaction(
  neuroFluxInfo: AugmentInfo,
  factionReps: Map<string, number>,
  repReq: number
): { faction: FactionName; currentRep: number } | null {
  let best: { faction: FactionName; currentRep: number } | null = null

  for (const faction of neuroFluxInfo.factions) {
    const currentRep = factionReps.get(faction) ?? 0
    if (currentRep < repReq) continue
    if (!best || currentRep > best.currentRep) {
      best = { faction, currentRep }
    }
  }

  return best
}

/**
 * First NeuroFlux level that still needs rep or money after simulating affordable regular augments.
 * Skips levels already covered by current money and faction rep.
 */
export function getNextNeuroFluxLevel(
  ns: NS,
  playerFactions: readonly FactionName[],
  grindFactions?: ReadonlySet<FactionName>
): NextNeuroFluxLevel | null {
  const purchaseFactions = filterAugmentPurchaseFactions([...playerFactions])
  const { affordableSorted, neuroFluxInfo, factionReps, playerMoney } = getAugmentData(ns, purchaseFactions)
  if (!neuroFluxInfo) return null

  const repGrindFactions = grindFactions ?? new Set(purchaseFactions)
  const allPurchaseNfFactions = new Set(
    neuroFluxInfo.factions.filter((faction) => purchaseFactions.includes(faction))
  )
  const positionOffset = affordableSorted.length
  let budget = playerMoney

  for (let i = 0; i < affordableSorted.length; i++) {
    budget -= affordableSorted[i].price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, i)
  }

  let levelIndex = 0
  for (; levelIndex < MAX_NEUROFLUX_SIM_LEVELS; levelIndex++) {
    const { price, repReq } = neuroFluxPurchaseCost(neuroFluxInfo, positionOffset, levelIndex)
    const tradeFaction = bestNeuroFluxTradeFaction(neuroFluxInfo, factionReps, repReq)

    if (!tradeFaction) {
      let grind = bestNeuroFluxRepGrindFaction(neuroFluxInfo, factionReps, repReq, repGrindFactions)
      if (!grind) {
        grind = bestNeuroFluxRepGrindFaction(neuroFluxInfo, factionReps, repReq, allPurchaseNfFactions)
      }
      if (!grind) return null
      return {
        levelIndex,
        price,
        repReq,
        need: "rep",
        faction: grind.faction,
        currentRep: grind.currentRep,
        repGap: grind.repGap,
      }
    }

    if (price > budget) {
      return {
        levelIndex,
        price,
        repReq,
        need: "money",
        faction: tradeFaction.faction,
        currentRep: tradeFaction.currentRep,
        repGap: 0,
      }
    }

    budget -= price
  }

  return null
}

/**
 * Collect and organize augmentation data from all player factions
 */
export function getAugmentData(ns: NS, playerFactions: FactionName[]): AugmentData {
  const relevantFactions = new Set(filterAugmentPurchaseFactions(playerFactions))
  const ownedSet = new Set(ns.singularity.getOwnedAugmentations(true))
  const catalog = getAugmentCatalog(ns)
  const augmentMap = new Map<string, AugmentInfo>()
  let neuroFluxInfo: AugmentInfo | null = null

  for (const entry of catalog.values()) {
    const factions = entry.factions.filter((faction) => relevantFactions.has(faction))
    if (factions.length === 0) continue

    const price = ns.singularity.getAugmentationPrice(entry.name)
    const owned = ownedSet.has(entry.name)

    if (entry.name.startsWith("NeuroFlux Governor")) {
      if (!neuroFluxInfo) {
        neuroFluxInfo = {
          name: entry.name,
          factions: [...factions],
          price,
          repReq: entry.repReq,
          owned,
          prereqs: entry.prereqs,
        }
      } else {
        for (const faction of factions) {
          if (!neuroFluxInfo.factions.includes(faction)) {
            neuroFluxInfo.factions.push(faction)
          }
        }
      }
      continue
    }

    augmentMap.set(entry.name, {
      name: entry.name,
      factions: [...factions],
      price,
      repReq: entry.repReq,
      owned,
      prereqs: entry.prereqs,
    })
  }

  // Get player stats
  const playerMoney = ns.getPlayer().money
  const factionReps = new Map<string, number>()
  for (const faction of filterAugmentPurchaseFactions(playerFactions)) {
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

  const { affordable, skippedHasRep } = buildAffordablePurchasePlan(potentiallyAffordable, playerMoney)
  const tooExpensiveCumulative = skippedHasRep

  // Sort unaffordable (no rep) by price (most expensive first)
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

  const AUGMENT_PRICE_MULT = AUGMENT_QUEUE_PRICE_MULT

  // Calculate total cost for display (affordableSorted already contains the correct augments)
  let totalCost = 0
  for (let i = 0; i < affordableSorted.length; i++) {
    totalCost += affordableSorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
  }

  // Purchase augmentations
  if (affordableSorted.length > 0) {
    ns.tprint(`Purchasing ${affordableSorted.length} augmentations (total cost: ${ns.format.number(totalCost)})`)

    for (let i = 0; i < affordableSorted.length; i++) {
      const aug = affordableSorted[i]
      const adjustedPrice = aug.price * Math.pow(AUGMENT_PRICE_MULT, i)
      const validFaction = aug.factions.find(
        (f) => !isAugmentPurchaseExcludedFaction(f) && (factionReps.get(f) ?? 0) >= aug.repReq
      )

      if (!validFaction) {
        ns.tprint(`No valid faction found for: ${aug.name}`)
        continue
      }

      if (dryRun) {
        ns.tprint(`Would purchase: ${aug.name} from ${validFaction} for ${ns.format.number(adjustedPrice)}`)
        purchaseCount++
        totalSpent += adjustedPrice
      } else {
        const success = ns.singularity.purchaseAugmentation(validFaction, aug.name)
        if (success) {
          ns.tprint(`Purchased: ${aug.name} from ${validFaction} for ${ns.format.number(adjustedPrice)}`)
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
    let currentMoney = dryRun ? ns.getPlayer().money - totalSpent : ns.getPlayer().money
    let neuroFluxIndex = 0
    let { price: currentPrice, repReq: currentRepReq } = dryRun
      ? neuroFluxPurchaseCost(neuroFluxInfo, affordableSorted.length, neuroFluxIndex)
      : {
          price: ns.singularity.getAugmentationPrice(neuroFluxInfo.name),
          repReq: ns.singularity.getAugmentationRepReq(neuroFluxInfo.name),
        }

    while (currentMoney >= currentPrice) {
      const currentValidFactions = neuroFluxInfo.factions.filter(
        (f) => !isAugmentPurchaseExcludedFaction(f) && (factionReps.get(f) ?? 0) >= currentRepReq
      )
      const currentValidFaction =
        currentValidFactions.length > 0
          ? currentValidFactions.reduce((best, current) =>
              (factionReps.get(current) ?? 0) > (factionReps.get(best) ?? 0) ? current : best
            )
          : undefined

      if (!currentValidFaction) {
        break
      }

      if (dryRun) {
        ns.tprint(
          `Would purchase: ${neuroFluxInfo.name} from ${currentValidFaction} for ${ns.format.number(currentPrice)} (rep: ${ns.format.number(currentRepReq)})`
        )
        purchaseCount++
        totalSpent += currentPrice
        currentMoney -= currentPrice
        neuroFluxIndex++
        ;({ price: currentPrice, repReq: currentRepReq } = neuroFluxPurchaseCost(
          neuroFluxInfo,
          affordableSorted.length,
          neuroFluxIndex
        ))
      } else {
        const success = ns.singularity.purchaseAugmentation(currentValidFaction, neuroFluxInfo.name)
        if (success) {
          ns.tprint(
            `Purchased: ${neuroFluxInfo.name} from ${currentValidFaction} for ${ns.format.number(currentPrice)} (rep: ${ns.format.number(currentRepReq)})`
          )
          purchaseCount++
          totalSpent += currentPrice
          currentMoney = ns.getPlayer().money
          ;({ price: currentPrice, repReq: currentRepReq } = {
            price: ns.singularity.getAugmentationPrice(neuroFluxInfo.name),
            repReq: ns.singularity.getAugmentationRepReq(neuroFluxInfo.name),
          })
        } else {
          ns.tprint(`Failed to purchase: ${neuroFluxInfo.name} from ${currentValidFaction}`)
          break
        }
      }
    }
  }

  ns.tprint("=".repeat(120))
  ns.tprint(
    dryRun
      ? `Would purchase ${purchaseCount} augmentations for ${ns.format.number(totalSpent)}`
      : `Purchased ${purchaseCount} augmentations for ${ns.format.number(totalSpent)}`
  )
  ns.tprint("=".repeat(120))

  if (purchaseCount > 0 && !dryRun) {
    const installNow = await ns.prompt("Install augmentations now and restart?")
    if (installNow) {
      ns.singularity.installAugmentations("/startBatchHome.js")
    }
  }
}
