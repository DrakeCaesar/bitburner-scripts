import type { NS } from "@ns"

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
  city: string
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
        city: data.location.city,
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
