import type { CityName, NS } from "@ns"
import { getPreferredFactionForInfiltrationRep } from "../factionWork.js"

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

/**
 * Infiltration reward order:
 * 1. Pre-favor augment rep, then cash for that augment (repeat per augment in purchase order)
 * 2. Donation favor rep (factions with unowned post-favor augments only)
 * 3. Post-favor augment rep, then cash for that augment (repeat per augment in purchase order)
 * 4. NeuroFlux Governor rep, then cash for the next level
 */
export function getInfiltrationRewardGoal(ns: NS): InfiltrationRewardGoal {
  if (isInfiltrationMoneyMode(ns)) return "money"
  return getPreferredFactionForInfiltrationRep(ns) != null ? "reputation" : "money"
}

export function getInfiltrationRewardPerLevel(
  target: InfiltrationTarget,
  goal: InfiltrationRewardGoal
): number {
  const reward = target.data.reward[goal === "money" ? "sellCash" : "tradeRep"]
  return reward / target.data.maxClearanceLevel
}

/** Bitburner city travel cost (CONSTANTS.TravelCost). */
export const INFILTRATION_TRAVEL_COST = 200_000

export function canAffordInfiltrationTravel(ns: NS): boolean {
  return ns.getPlayer().money >= INFILTRATION_TRAVEL_COST
}

function pickBestInfiltrationTarget(
  targets: readonly InfiltrationTarget[],
  goal: InfiltrationRewardGoal
): InfiltrationTarget | null {
  if (targets.length === 0) return null

  let best = targets[0]
  let bestRate = getInfiltrationRewardPerLevel(best, goal)

  for (let i = 1; i < targets.length; i++) {
    const target = targets[i]
    const rate = getInfiltrationRewardPerLevel(target, goal)
    const rewardKey = goal === "money" ? "sellCash" : "tradeRep"
    const bestTotalReward = best.data.reward[rewardKey]
    const totalReward = target.data.reward[rewardKey]

    if (
      rate > bestRate ||
      (rate === bestRate && totalReward > bestTotalReward) ||
      (rate === bestRate && totalReward === bestTotalReward && target.difficulty > best.difficulty)
    ) {
      best = target
      bestRate = rate
    }
  }

  return best
}

/** Best available target for the chosen victory reward (sell cash or trade rep). */
export function getBestInfiltrationTarget(
  ns: NS,
  goal: InfiltrationRewardGoal,
  city?: CityName
): InfiltrationTarget | null {
  const targets = getAvailableInfiltrationTargets(ns)
  const filtered = city != null ? targets.filter((target) => target.city === city) : targets
  return pickBestInfiltrationTarget(filtered, goal)
}

/**
 * Best target for the player. When travel is unaffordable, uses the best target in the current city.
 */
export function getBestInfiltrationTargetForPlayer(
  ns: NS,
  goal: InfiltrationRewardGoal
): InfiltrationTarget | null {
  const playerCity = ns.getPlayer().city
  const best = getBestInfiltrationTarget(ns, goal)
  if (best == null) return null
  if (best.city === playerCity || canAffordInfiltrationTravel(ns)) return best
  return getBestInfiltrationTarget(ns, goal, playerCity)
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
