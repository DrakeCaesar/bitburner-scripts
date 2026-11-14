import type { NS } from "@ns"
import type { GoOpponent } from "@ns"
import { IPVGO_OPPONENTS, IPVGO_HIDDEN_OPPONENT, IPVGO_KOMI_BY_OPPONENT } from "./types.js"

export const IPVGO_SETTINGS_FILE = "ipvgo-settings.json"
/** Nodes per move, matching the bench Run pane's node budget for 5x5. */
export const IPVGO_DEFAULT_SIMS = 10000
export const IPVGO_SIMS_MAX = 20000
/**
 * Bumped when the default budget changes meaningfully. A file written by an older script
 * stores the old default (1 000 nodes) for every faction, which would otherwise pin the
 * search to a tenth of what the bench was tuned with; the sims are re-defaulted once and
 * which factions are enabled is kept.
 */
export const IPVGO_SETTINGS_VERSION = 2

/** Matches opponentDetails[].bonusPower in bitburner-src Go/Constants.ts */
export const IPVGO_BONUS_POWER: Record<GoOpponent, number> = {
  Netburners: 1.3,
  "Slum Snakes": 1.2,
  "The Black Hand": 0.9,
  Tetrads: 0.7,
  Daedalus: 1.1,
  Illuminati: 0.7,
  "????????????": 2,
  "No AI": 0,
}

export type IpvgoFactionConfig = {
  factionSims: Partial<Record<GoOpponent, number>>
  /** When false, faction is skipped by auto-rotation (default true). */
  factionEnabled: Partial<Record<GoOpponent, boolean>>
  /** Written by saveFactionConfig; an older file is migrated by loadFactionConfig. */
  settingsVersion?: number
}

function defaultFactionConfig(): IpvgoFactionConfig {
  const factionSims: Partial<Record<GoOpponent, number>> = {}
  const factionEnabled: Partial<Record<GoOpponent, boolean>> = {}
  for (const faction of IPVGO_OPPONENTS) {
    factionSims[faction] = IPVGO_DEFAULT_SIMS
    factionEnabled[faction] = true
  }
  return { factionSims, factionEnabled }
}

function clampSims(value: number): number {
  return Math.min(IPVGO_SIMS_MAX, Math.max(100, Math.floor(value)))
}

export function getGoEffectMults(ns: NS): { goPower: number; sourceFileBonus: number } {
  const goPower = ns.getBitNodeMultipliers().GoPower
  let sourceFileBonus = 1
  try {
    const sf14 = ns.singularity.getOwnedSourceFiles().find((sf) => sf.n === 14)?.lvl ?? 0
    if (sf14 > 0) sourceFileBonus = 2
  } catch {
    /* singularity API may be unavailable early */
  }
  return { goPower, sourceFileBonus }
}

/** Mirror of CalculateEffect in bitburner-src Go/effects/effect.ts */
export function calculateIpvgoEffect(
  nodePower: number,
  faction: GoOpponent,
  goPower: number,
  sourceFileBonus: number
): number {
  const power = IPVGO_BONUS_POWER[faction] ?? 1
  return (
    1 +
    Math.log(nodePower + 1) *
      Math.pow(nodePower + 1, 0.3) *
      0.002 *
      power *
      goPower *
      sourceFileBonus
  )
}

/** Invert bonusPercent from getStats() into approximate node power for ranking factions. */
export function estimateNodePowerFromBonus(
  bonusPercent: number,
  faction: GoOpponent,
  goPower: number,
  sourceFileBonus: number
): number {
  if (bonusPercent <= 0) return 0
  const target = 1 + bonusPercent / 100
  let lo = 0
  let hi = 10_000_000
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (calculateIpvgoEffect(mid, faction, goPower, sourceFileBonus) < target) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

export function estimateNodePowerByFaction(
  ns: NS,
  opponentStats: Partial<Record<GoOpponent, { bonusPercent?: number }>>
): Partial<Record<GoOpponent, number>> {
  const { goPower, sourceFileBonus } = getGoEffectMults(ns)
  const out: Partial<Record<GoOpponent, number>> = {}
  for (const faction of IPVGO_OPPONENTS) {
    const stats = opponentStats[faction]
    out[faction] = estimateNodePowerFromBonus(
      stats?.bonusPercent ?? 0,
      faction,
      goPower,
      sourceFileBonus
    )
  }
  return out
}

export function isFactionEnabled(config: IpvgoFactionConfig, faction: GoOpponent): boolean {
  return config.factionEnabled[faction] !== false
}

export function toggleFactionEnabled(
  config: IpvgoFactionConfig,
  faction: GoOpponent
): IpvgoFactionConfig {
  return {
    ...config,
    factionEnabled: {
      ...config.factionEnabled,
      [faction]: !isFactionEnabled(config, faction),
    },
  }
}

/** Mirror of getDifficultyMultiplier in bitburner-src Go/effects/effect.ts */
export function getDifficultyMultiplier(komi: number, boardSize: number): number {
  const tinyBoardVsIlluminati = boardSize === 5 && komi === IPVGO_KOMI_BY_OPPONENT.Illuminati
  return tinyBoardVsIlluminati ? 8 : (komi + 0.5) * 0.25
}

/**
 * Mirror of getWinstreakMultiplier in bitburner-src Go/effects/effect.ts, applied to the win
 * that has not happened yet: the multiplier of the next win given the current streak.
 */
export function getNextWinStreakMultiplier(winStreak: number): number {
  return winStreak < 0
    ? 1 + 0.5 * Math.min(-winStreak, 8)
    : 1 + 0.25 * Math.min(winStreak + 1, 8)
}

export type IpvgoFactionGain = {
  faction: GoOpponent
  /** Expected node power from one more win: slope x faction power x difficulty x streak x p(win). */
  score: number
  /** d(CalculateEffect)/d(nodePower): what one more point of node power is worth right now. */
  slope: number
  /** Komi-based board multiplier the win would be paid at. */
  difficulty: number
  /** Streak multiplier the win would be paid at. */
  streak: number
  /** Share of past games against this faction we won, smoothed towards an even record. */
  winProbability: number
}

/**
 * What one more win against this faction is worth in node power, ignoring the
 * faction-independent constants in CalculateEffect (GoPower, Source-File 14), which cancel
 * out when factions are compared. The score is therefore a ranking, not a node count.
 */
export function estimateFactionGain(
  faction: GoOpponent,
  nodePower: number,
  stats: { wins?: number; losses?: number; winStreak?: number } | undefined,
  boardSize: number
): IpvgoFactionGain {
  const power = IPVGO_BONUS_POWER[faction] ?? 1
  const nodes = Math.max(0, nodePower)
  const slope = Math.pow(nodes + 1, -0.7) * (1 + 0.3 * Math.log(nodes + 1))
  const difficulty = getDifficultyMultiplier(IPVGO_KOMI_BY_OPPONENT[faction] ?? 5.5, boardSize)
  const streak = getNextWinStreakMultiplier(stats?.winStreak ?? 0)
  // Laplace-smoothed record, so a faction we have never played is not assumed to be a win.
  const wins = Math.max(0, Math.round(stats?.wins ?? 0))
  const losses = Math.max(0, Math.round(stats?.losses ?? 0))
  const winProbability = (wins + 1) / (wins + losses + 2)
  return {
    faction,
    score: winProbability * power * slope * difficulty * streak,
    slope,
    difficulty,
    streak,
    winProbability,
  }
}

/**
 * Ranks the factions the rotation may start by the node power one more win would pay, and
 * picks the best. Node power alone is a poor target: a faction sitting on a large power
 * total is worth less per win (the effect curve flattens) and some boards pay eight times
 * what others do, so the rotation aims at the largest expected gain instead.
 */
export function pickHighestGainFaction(
  nodePowerByFaction: Partial<Record<GoOpponent, number>>,
  opponentStats: Partial<
    Record<GoOpponent, { wins?: number; losses?: number; winStreak?: number }>
  >,
  config: IpvgoFactionConfig,
  boardSize: number
): GoOpponent {
  // The hidden faction is not in the rotation: its subnet is a fixed 19x19 board, and the
  // rotation only knows the 5x5-13x13 sizes the faction table can start.
  const pool = IPVGO_OPPONENTS.filter(
    (faction) => faction !== IPVGO_HIDDEN_OPPONENT && isFactionEnabled(config, faction)
  )
  const candidates = pool.length > 0 ? pool : IPVGO_OPPONENTS.filter((f) => f !== IPVGO_HIDDEN_OPPONENT)
  let best = candidates[0]
  let bestScore = -Infinity
  for (const faction of candidates) {
    const gain = estimateFactionGain(
      faction,
      nodePowerByFaction[faction] ?? 0,
      opponentStats[faction],
      boardSize
    )
    if (gain.score > bestScore) {
      best = faction
      bestScore = gain.score
    }
  }
  return best
}

/** The expected-gain score of each rotation candidate, for the dashboard. */
export function estimateFactionGains(
  nodePowerByFaction: Partial<Record<GoOpponent, number>>,
  opponentStats: Partial<
    Record<GoOpponent, { wins?: number; losses?: number; winStreak?: number }>
  >,
  boardSize: number
): Partial<Record<GoOpponent, IpvgoFactionGain>> {
  const out: Partial<Record<GoOpponent, IpvgoFactionGain>> = {}
  for (const faction of IPVGO_OPPONENTS) {
    out[faction] = estimateFactionGain(
      faction,
      nodePowerByFaction[faction] ?? 0,
      opponentStats[faction],
      boardSize
    )
  }
  return out
}

export function loadFactionConfig(ns: NS): IpvgoFactionConfig {
  const defaults = defaultFactionConfig()
  try {
    if (!ns.fileExists(IPVGO_SETTINGS_FILE)) return defaults
    const raw = ns.read(IPVGO_SETTINGS_FILE) as string
    const parsed = JSON.parse(raw) as Partial<IpvgoFactionConfig>
    const factionSims = { ...defaults.factionSims }
    const factionEnabled = { ...defaults.factionEnabled }
    if (parsed.settingsVersion === IPVGO_SETTINGS_VERSION) {
      if (parsed.factionSims && typeof parsed.factionSims === "object") {
        for (const faction of IPVGO_OPPONENTS) {
          const value = parsed.factionSims[faction]
          if (typeof value === "number" && Number.isFinite(value)) {
            factionSims[faction] = clampSims(value)
          }
        }
      }
    }
    if (parsed.factionEnabled && typeof parsed.factionEnabled === "object") {
      for (const faction of IPVGO_OPPONENTS) {
        const value = parsed.factionEnabled[faction]
        if (typeof value === "boolean") {
          factionEnabled[faction] = value
        }
      }
    }
    return { factionSims, factionEnabled }
  } catch {
    return defaults
  }
}

export function saveFactionConfig(ns: NS, config: IpvgoFactionConfig): void {
  const factionSims: Partial<Record<GoOpponent, number>> = {}
  const factionEnabled: Partial<Record<GoOpponent, boolean>> = {}
  for (const faction of IPVGO_OPPONENTS) {
    factionSims[faction] = clampSims(config.factionSims[faction] ?? IPVGO_DEFAULT_SIMS)
    factionEnabled[faction] = isFactionEnabled(config, faction)
  }
  ns.write(
    IPVGO_SETTINGS_FILE,
    JSON.stringify({ settingsVersion: IPVGO_SETTINGS_VERSION, factionSims, factionEnabled }, null, 2),
    "w"
  )
}

export function getFactionSims(config: IpvgoFactionConfig, faction: GoOpponent): number {
  return clampSims(config.factionSims[faction] ?? IPVGO_DEFAULT_SIMS)
}

