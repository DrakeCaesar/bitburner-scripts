import type { CityName, FactionName, NS } from "@ns"
import { getTargetFavor } from "../factionWork.js"

/** Matches in-game MaxDifficultyForInfiltration (Intro screen uses rating out of 100). */
export const MAX_INFILTRATION_DIFFICULTY = 3.5

export interface InfiltrationLocation {
  difficulty: number
  maxClearanceLevel: number
  startingSecurityLevel: number
  location: { city: string; name: string }
  reward: { sellCash: number; tradeRep: number; SoARep: number }
}

export interface InfiltrationTarget {
  city: CityName
  name: string
  difficulty: number
  rating: number
  tier: string
  data: InfiltrationLocation
}

interface InfiltrationApi {
  getPossibleLocations(): Array<{ city: string; name: string }>
  getInfiltration(location: string): InfiltrationLocation
}

export function getInfiltrationApi(ns: NS): InfiltrationApi | null {
  return (ns as NS & { infiltration?: InfiltrationApi }).infiltration ?? null
}

/** Same 0-100 scale shown on the infiltration intro screen. */
export function displayRating(rawDifficulty: number): number {
  return (Math.min(rawDifficulty, MAX_INFILTRATION_DIFFICULTY) * 100) / MAX_INFILTRATION_DIFFICULTY
}

export function tierLabel(rawDifficulty: number): string {
  if (rawDifficulty >= MAX_INFILTRATION_DIFFICULTY) return "Blocked"
  if (rawDifficulty >= 3) return "Impossible"
  if (rawDifficulty >= 2) return "Hard"
  if (rawDifficulty >= 1) return "Normal"
  return "Trivial"
}

export function isBlockedDifficulty(rawDifficulty: number): boolean {
  return rawDifficulty >= MAX_INFILTRATION_DIFFICULTY
}

/** All infiltratable targets, sorted easiest first. Skips blocked locations. */
export function getAvailableInfiltrationTargets(ns: NS): InfiltrationTarget[] {
  const infiltration = getInfiltrationApi(ns)
  if (!infiltration) return []

  const targets: InfiltrationTarget[] = []

  for (const loc of infiltration.getPossibleLocations()) {
    try {
      const data = infiltration.getInfiltration(loc.name)
      if (isBlockedDifficulty(data.difficulty)) continue

      targets.push({
        city: data.location.city as CityName,
        name: data.location.name,
        difficulty: data.difficulty,
        rating: displayRating(data.difficulty),
        tier: tierLabel(data.difficulty),
        data,
      })
    } catch {
      // Location may be unavailable in this BitNode or city state.
    }
  }

  targets.sort((a, b) => a.difficulty - b.difficulty)
  return targets
}

export function getEasiestInfiltrationTarget(ns: NS): InfiltrationTarget | null {
  const targets = getAvailableInfiltrationTargets(ns)
  return targets[0] ?? null
}

/** Hardest non-blocked target (highest difficulty the game still allows). */
export function getHardestInfiltrationTarget(ns: NS): InfiltrationTarget | null {
  const targets = getAvailableInfiltrationTargets(ns)
  return targets[targets.length - 1] ?? null
}

export type InfiltrationRewardGoal = "money" | "reputation"

/** First script arg: `money` / `cash` / `m` forces cash rewards and targets. */
export function isInfiltrationMoneyMode(ns: NS): boolean {
  const arg = String(ns.args[0] ?? "").toLowerCase()
  return arg === "money" || arg === "cash" || arg === "m"
}

/** Any script arg `debug` enables verbose victory audit logging (e.g. money shortfall checks). */
export function isInfiltrationDebugMode(ns: NS): boolean {
  return ns.args.some((arg) => String(arg).toLowerCase() === "debug")
}

export function getInfiltrationRewardPerLevel(
  target: InfiltrationTarget,
  goal: InfiltrationRewardGoal
): number {
  const reward = target.data.reward[goal === "money" ? "sellCash" : "tradeRep"]
  return reward / target.data.maxClearanceLevel
}

export type InfiltrationVictoryRewardPath = "sell" | "trade" | "donate"

export interface InfiltrationVictoryRewardPaths {
  sellCash: number
  tradeRep: number
  donateRep: number
  /** Donation unlocked by installed favor only (not banked favor gain). */
  canDonate: boolean
  effectiveRep: number
  chosenPath: InfiltrationVictoryRewardPath
}

/** Installed favor meets donation threshold; banked favor gain does not count. */
export function factionCanDonateForRep(ns: NS, faction: FactionName): boolean {
  return ns.singularity.getFactionFavor(faction) >= getTargetFavor(ns)
}

export function repFromInfiltrationSellCash(ns: NS, sellCash: number): number {
  try {
    return ns.formulas.reputation.repFromDonation(sellCash, ns.getPlayer())
  } catch {
    return 0
  }
}

export function getInfiltrationVictoryRewardPaths(
  ns: NS,
  sellCash: number,
  tradeRep: number,
  rewardGoal: InfiltrationRewardGoal,
  faction: FactionName | null
): InfiltrationVictoryRewardPaths {
  const donateRep = repFromInfiltrationSellCash(ns, sellCash)
  const canDonate = faction != null && factionCanDonateForRep(ns, faction)

  if (rewardGoal !== "reputation" || faction == null) {
    return {
      sellCash,
      tradeRep,
      donateRep,
      canDonate,
      effectiveRep: tradeRep,
      chosenPath: "sell",
    }
  }

  if (canDonate && donateRep > tradeRep) {
    return {
      sellCash,
      tradeRep,
      donateRep,
      canDonate,
      effectiveRep: donateRep,
      chosenPath: "donate",
    }
  }

  return {
    sellCash,
    tradeRep,
    donateRep,
    canDonate,
    effectiveRep: tradeRep,
    chosenPath: "trade",
  }
}

export function getInfiltrationVictoryRewardPathsForTarget(
  ns: NS,
  target: InfiltrationTarget,
  rewardGoal: InfiltrationRewardGoal,
  faction: FactionName | null
): InfiltrationVictoryRewardPaths {
  return getInfiltrationVictoryRewardPaths(
    ns,
    target.data.reward.sellCash,
    target.data.reward.tradeRep,
    rewardGoal,
    faction
  )
}

export function shouldSellAndDonateForRep(
  ns: NS,
  sellCash: number,
  tradeRep: number,
  faction: FactionName
): boolean {
  const paths = getInfiltrationVictoryRewardPaths(ns, sellCash, tradeRep, "reputation", faction)
  return paths.chosenPath === "donate"
}

/** Bitburner city travel cost (CONSTANTS.TravelCost). */
export const INFILTRATION_TRAVEL_COST = 200_000

export function canAffordInfiltrationTravel(ns: NS): boolean {
  return ns.getPlayer().money >= INFILTRATION_TRAVEL_COST
}

export async function travelToInfiltrationCity(ns: NS, city: CityName): Promise<boolean> {
  if (ns.getPlayer().city === city) {
    return true
  }

  if (!ns.singularity.travelToCity(city)) {
    return false
  }

  return ns.getPlayer().city === city
}

function pickBestInfiltrationTarget(
  ns: NS,
  targets: readonly InfiltrationTarget[],
  goal: InfiltrationRewardGoal,
  repGrindFaction?: FactionName | null
): InfiltrationTarget | null {
  if (targets.length === 0) return null

  const useEffectiveRep = goal === "reputation" && repGrindFaction != null

  let best = targets[0]
  let bestPaths = useEffectiveRep
    ? getInfiltrationVictoryRewardPathsForTarget(ns, best, goal, repGrindFaction)
    : null
  let bestRate = useEffectiveRep
    ? bestPaths!.effectiveRep / best.data.maxClearanceLevel
    : getInfiltrationRewardPerLevel(best, goal)
  let bestTotal = useEffectiveRep ? bestPaths!.effectiveRep : best.data.reward[goal === "money" ? "sellCash" : "tradeRep"]

  for (let i = 1; i < targets.length; i++) {
    const target = targets[i]
    const paths = useEffectiveRep
      ? getInfiltrationVictoryRewardPathsForTarget(ns, target, goal, repGrindFaction)
      : null
    const rate = useEffectiveRep
      ? paths!.effectiveRep / target.data.maxClearanceLevel
      : getInfiltrationRewardPerLevel(target, goal)
    const totalReward = useEffectiveRep
      ? paths!.effectiveRep
      : target.data.reward[goal === "money" ? "sellCash" : "tradeRep"]

    if (
      rate > bestRate ||
      (rate === bestRate && totalReward > bestTotal) ||
      (rate === bestRate && totalReward === bestTotal && target.difficulty > best.difficulty)
    ) {
      best = target
      bestPaths = paths
      bestRate = rate
      bestTotal = totalReward
    }
  }

  return best
}

/** Best available target for the chosen victory reward (sell cash or trade rep). */
export function getBestInfiltrationTarget(
  ns: NS,
  goal: InfiltrationRewardGoal,
  city?: CityName,
  repGrindFaction?: FactionName | null
): InfiltrationTarget | null {
  const targets = getAvailableInfiltrationTargets(ns)
  const filtered = city != null ? targets.filter((target) => target.city === city) : targets
  return pickBestInfiltrationTarget(ns, filtered, goal, repGrindFaction)
}

/**
 * Best target for the player. When travel is unaffordable, uses the best target in the current city.
 */
export function getBestInfiltrationTargetForPlayer(
  ns: NS,
  goal: InfiltrationRewardGoal,
  repGrindFaction?: FactionName | null
): InfiltrationTarget | null {
  const playerCity = ns.getPlayer().city
  const best = getBestInfiltrationTarget(ns, goal, undefined, repGrindFaction)
  if (best == null) return null
  if (best.city === playerCity || canAffordInfiltrationTravel(ns)) return best
  return getBestInfiltrationTarget(ns, goal, playerCity, repGrindFaction)
}

/** Available targets, hardest first. */
export function getInfiltrationTargetsHardestFirst(ns: NS): InfiltrationTarget[] {
  return [...getAvailableInfiltrationTargets(ns)].reverse()
}

export function getInfiltrationTargetByName(ns: NS, locationName: string): InfiltrationTarget | null {
  const infiltration = getInfiltrationApi(ns)
  if (!infiltration) return null

  try {
    const data = infiltration.getInfiltration(locationName)
    return {
      city: data.location.city as CityName,
      name: data.location.name,
      difficulty: data.difficulty,
      rating: displayRating(data.difficulty),
      tier: tierLabel(data.difficulty),
      data,
    }
  } catch {
    return null
  }
}

/** All API-listed targets, including blocked ones. */
export function getAllInfiltrationTargets(ns: NS): InfiltrationTarget[] {
  const infiltration = getInfiltrationApi(ns)
  if (!infiltration) return []

  const targets: InfiltrationTarget[] = []

  for (const loc of infiltration.getPossibleLocations()) {
    try {
      const data = infiltration.getInfiltration(loc.name)
      targets.push({
        city: data.location.city as CityName,
        name: data.location.name,
        difficulty: data.difficulty,
        rating: displayRating(data.difficulty),
        tier: tierLabel(data.difficulty),
        data,
      })
    } catch {
      // Location may be unavailable in this BitNode or city state.
    }
  }

  return targets
}

/** True when every infiltration location is startable (intro rating below 100 / not blocked). */
export function areAllInfiltrationsDoable(ns: NS): boolean {
  const targets = getAllInfiltrationTargets(ns)
  if (targets.length === 0) return false
  return targets.every((target) => !isBlockedDifficulty(target.difficulty))
}

export interface InfiltrationCityGroup {
  city: CityName
  targets: InfiltrationTarget[]
}

/** Group targets by city to minimize travel during visit tests. */
export function getInfiltrationTargetsByCity(ns: NS): InfiltrationCityGroup[] {
  const byCity = new Map<CityName, InfiltrationTarget[]>()

  for (const target of getAllInfiltrationTargets(ns)) {
    const list = byCity.get(target.city) ?? []
    list.push(target)
    byCity.set(target.city, list)
  }

  const groups: InfiltrationCityGroup[] = []

  for (const city of [...byCity.keys()].sort((a, b) => a.localeCompare(b))) {
    const targets = byCity.get(city) ?? []
    targets.sort((a, b) => a.name.localeCompare(b.name))
    groups.push({ city, targets })
  }

  return groups
}
