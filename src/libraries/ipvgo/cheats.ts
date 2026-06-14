import { NS } from "@ns"
import type { IpvgoBoard, IpvgoValidMoves } from "./types.js"

export type CheatKind = "repair" | "remove"

export type CheatAction = {
  kind: CheatKind
  x: number
  y: number
  score: number
}

export type CheatStats = {
  available: boolean
  count: number
  successChance: number
}

const MIN_CHEAT_CHANCE_FIRST = 0.55
const MIN_CHEAT_CHANCE_REPEAT = 0.75

function neighbors(size: number, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (y > 0) out.push([x, y - 1])
  if (x < size - 1) out.push([x + 1, y])
  if (y < size - 1) out.push([x, y + 1])
  if (x > 0) out.push([x - 1, y])
  return out
}

function collectChain(board: IpvgoBoard, x: number, y: number, color: "X" | "O"): Array<[number, number]> {
  const chain: Array<[number, number]> = []
  const stack: Array<[number, number]> = [[x, y]]
  const seen = new Set<string>()

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!
    const key = `${cx},${cy}`
    if (seen.has(key) || board[cx][cy] !== color) continue
    seen.add(key)
    chain.push([cx, cy])
    for (const [nx, ny] of neighbors(board.length, cx, cy)) {
      if (!seen.has(`${nx},${ny}`) && board[nx][ny] === color) stack.push([nx, ny])
    }
  }

  return chain
}

function chainLiberties(board: IpvgoBoard, chain: Array<[number, number]>): Set<string> {
  const liberties = new Set<string>()
  for (const [x, y] of chain) {
    for (const [nx, ny] of neighbors(board.length, x, y)) {
      if (board[nx][ny] === ".") liberties.add(`${nx},${ny}`)
    }
  }
  return liberties
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

export function shouldAttemptCheat(stats: CheatStats): boolean {
  if (!stats.available) return false
  const threshold = stats.count > 0 ? MIN_CHEAT_CHANCE_REPEAT : MIN_CHEAT_CHANCE_FIRST
  return stats.successChance >= threshold
}

/**
 * Prefer removing an opponent stone in atari, then repairing offline nodes next to our stones.
 */
export function findCheatAction(board: IpvgoBoard, _validMoves: IpvgoValidMoves): CheatAction | null {
  const size = board.length
  let bestRemove: CheatAction | null = null
  let bestRepair: CheatAction | null = null

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const cell = board[x][y]

      if (cell === "O") {
        const chain = collectChain(board, x, y, "O")
        const liberties = chainLiberties(board, chain)
        if (liberties.size === 1) {
          const score = 100 + chain.length
          if (!bestRemove || score > bestRemove.score) {
            bestRemove = { kind: "remove", x, y, score }
          }
        }
      }

      if (cell === "#") {
        let friendlyNeighbors = 0
        let openNeighbors = 0
        for (const [nx, ny] of neighbors(size, x, y)) {
          const neighbor = board[nx][ny]
          if (neighbor === "X") friendlyNeighbors++
          if (neighbor === ".") openNeighbors++
        }
        if (friendlyNeighbors > 0) {
          const score = friendlyNeighbors * 3 + openNeighbors
          if (!bestRepair || score > bestRepair.score) {
            bestRepair = { kind: "repair", x, y, score }
          }
        }
      }
    }
  }

  if (bestRemove) return bestRemove
  return bestRepair
}

export async function executeCheat(
  ns: NS,
  action: CheatAction,
  boardBefore: IpvgoBoard
): Promise<{ result: Awaited<ReturnType<NS["go"]["makeMove"]>>; succeeded: boolean }> {
  const beforeCell = boardBefore[action.x][action.y]

  const result =
    action.kind === "repair"
      ? await ns.go.cheat.repairOfflineNode(action.x, action.y)
      : await ns.go.cheat.removeRouter(action.x, action.y)

  const afterCell = ns.go.getBoardState()[action.x][action.y]
  const succeeded =
    afterCell !== beforeCell &&
    ((action.kind === "repair" && beforeCell === "#" && afterCell === ".") ||
      (action.kind === "remove" && beforeCell === "O" && afterCell === "."))

  return { result, succeeded }
}
