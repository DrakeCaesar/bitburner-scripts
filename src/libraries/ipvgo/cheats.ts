import type { NS } from "@ns"
import type { IpvgoBoard, IpvgoCheatProposal } from "./types.js"

export type CheatStats = {
  available: boolean
  count: number
  successChance: number
}

/** The engine's cheat kinds (exploiter.hpp CheatKind), in the order it numbers them. */
export const CHEAT_KIND_NAMES: Record<number, string> = {
  1: "remove router",
  2: "two moves",
  3: "destroy node",
  4: "repair node",
}

export type CheatContext = {
  /** Attempts already spent this game. */
  count: number
  /** Player.mults.crime_success, part of the success chance. */
  crimeSuccessMult: number
  /** Source-File 14 level; 3 adds the flat +25 points. */
  sourceFile14Level: number
}

export type CheatOutcome = "succeeded" | "skipped" | "ejected" | "invalid"

export type CheatPlay = {
  outcome: CheatOutcome
  /** Row label for the move log, e.g. "remove router 2,3 succeeded". */
  label: string
  /** White's response, when the call produced one. */
  result: Awaited<ReturnType<NS["go"]["makeMove"]>> | null
}

export function readCheatStats(ns: NS): CheatStats {
  try {
    const count = ns.go.cheat.getCheatCount()
    return {
      available: true,
      count,
      successChance: ns.go.cheat.getCheatSuccessChance(count),
    }
  } catch {
    return { available: false, count: 0, successChance: 0 }
  }
}

/**
 * The player inputs the engine's cheat pricing needs. The Source-File 14 level comes from
 * `getResetInfo()` (1 GB) rather than `getOwnedSourceFiles()` (5 GB) for the same number.
 */
export function readCheatContext(ns: NS): CheatContext {
  let count = 0
  let chance = 0
  try {
    count = ns.go.cheat.getCheatCount()
    chance = ns.go.cheat.getCheatSuccessChance(count)
  } catch {
    /* Source-File 14 not owned; the engine will not be asked to cheat */
  }

  let crimeSuccessMult = 1
  try {
    crimeSuccessMult = ns.getPlayer().mults.crime_success
  } catch {
    /* keep the neutral value */
  }

  return { count, crimeSuccessMult, sourceFile14Level: readSourceFile14Level(ns, count, chance, crimeSuccessMult) }
}

/**
 * Source-File 14 level, 0 or 3 (3 is the only level that pays, a flat +0.25).
 *
 * `getResetInfo()` reports the owned source files directly. When it is unavailable, fall back
 * to inferring the bonus from the game's own chance: the base is
 * `0.6 * (0.7 - 0.02n)^n * crime_success` and whatever the game adds on top is the bonus. That
 * inference only works below the clamp - once the chance saturates at 1.0 there is nothing left
 * to measure, and it used to report "no Source-File" in exactly the games where the cheat was
 * certain (crime_success above ~3.4 with two attempts spent).
 */
function readSourceFile14Level(ns: NS, count: number, chance: number, crimeSuccessMult: number): 0 | 3 {
  try {
    const owned = ns.getResetInfo()?.ownedSF
    const level = owned instanceof Map ? owned.get(14) : (owned as Record<number, number> | undefined)?.[14]
    if (typeof level === "number") return level === 3 ? 3 : 0
  } catch {
    /* older build without getResetInfo: infer it below */
  }
  const base = 0.6 * Math.pow(0.7 - 0.02 * count, count) * crimeSuccessMult
  // Only meaningful while the game's chance is not clamped.
  if (chance >= 0.999) return 0
  return chance - base > 0.12 ? 3 : 0
}

function cellAt(board: IpvgoBoard, x: number, y: number): string | undefined {
  return board[x]?.[y]
}

/**
 * The points the proposal touches, or null when the board no longer allows it. The game
 * rejects an offline target for the two placement cheats, and takes any point for the two
 * board-editing ones, so the same rules are mirrored here.
 */
function cheatTargets(
  proposal: IpvgoCheatProposal,
  board: IpvgoBoard,
  kind: number
): Array<[number, number]> | null {
  const first: [number, number] = [proposal.x1, proposal.y1]
  const firstCell = cellAt(board, first[0], first[1])
  if (firstCell === undefined) return null

  if (kind === 1) return firstCell === "#" ? null : [first]
  if (kind === 2) {
    const second: [number, number] = [proposal.x2, proposal.y2]
    const secondCell = cellAt(board, second[0], second[1])
    if (firstCell === "#" || secondCell === undefined || secondCell === "#") return null
    return [first, second]
  }
  if (kind === 3) return [first]
  if (kind === 4) return [first]
  return null
}

/** Whether the board after the attempt shows the cheat landed, per kind. */
function cheatApplied(kind: number, targets: Array<[number, number]>, board: IpvgoBoard): boolean {
  const cell = ([x, y]: [number, number]): string | undefined => cellAt(board, x, y)
  if (kind === 1) return cell(targets[0]) === "."
  if (kind === 2) return cell(targets[0]) === "X" && cell(targets[1]) === "X"
  if (kind === 3) return cell(targets[0]) === "#"
  if (kind === 4) return cell(targets[0]) === "."
  return false
}

function describeTargets(targets: Array<[number, number]>): string {
  return targets.map(([x, y]) => `${x},${y}`).join(" + ")
}

/**
 * Plays the cheat the engine preferred and reports what the game did with it.
 *
 * A failed attempt skips our turn, and past the first attempt it also ejects us 10% of the
 * time - the only way a failed cheat ends a game - so the outcome is read back from the
 * board rather than assumed: the effect is visible on the target point.
 */
export async function playEngineCheat(
  ns: NS,
  proposal: IpvgoCheatProposal,
  boardBefore: IpvgoBoard
): Promise<CheatPlay> {
  const targets = cheatTargets(proposal, boardBefore, proposal.kind)
  const name = CHEAT_KIND_NAMES[proposal.kind] ?? `cheat ${proposal.kind}`
  if (!targets) {
    return { outcome: "invalid", label: `${name} unavailable`, result: null }
  }

  const [first, second] = targets
  const result =
    proposal.kind === 1
      ? await ns.go.cheat.removeRouter(first[0], first[1])
      : proposal.kind === 2
        ? await ns.go.cheat.playTwoMoves(first[0], first[1], second[0], second[1])
        : proposal.kind === 3
          ? await ns.go.cheat.destroyNode(first[0], first[1])
          : await ns.go.cheat.repairOfflineNode(first[0], first[1])

  const after = ns.go.getBoardState() as IpvgoBoard
  let outcome: CheatOutcome = "skipped"
  if (cheatApplied(proposal.kind, targets, after)) outcome = "succeeded"
  else if (result.type === "gameOver") outcome = "ejected"

  return { outcome, label: `${name} ${describeTargets(targets)} ${outcome}`, result }
}
