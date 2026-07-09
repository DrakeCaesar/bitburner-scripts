import type { GoOpponent } from "@ns"

export type IpvgoStone = "X" | "O" | "." | "#"
export type IpvgoBoard = string[]
export type IpvgoColor = "X" | "O"

export type IpvgoMove = { type: "move"; x: number; y: number } | { type: "pass" }

export type IpvgoValidMoves = boolean[][]

export type IpvgoMoveRequest = {
  board: IpvgoBoard
  history: IpvgoBoard[]
  komi: number
  iterations: number
  playAs: IpvgoColor
  /** Authoritative legal moves from ns.go.analysis.getValidMoves() for the root position. */
  validMoves: IpvgoValidMoves
  /** Optional client id; server forwards to KataGo for cancel/terminate. */
  requestId?: string
  /** Opponent faction; used by the native torch engine to run MCTS with the correct White AI. */
  opponent?: GoOpponent
}

export type IpvgoMoveResponse = {
  move: IpvgoMove
  iterations: number
  elapsedMs: number
}

export const IPVGO_BOARD_SIZES = [5, 7, 9, 13] as const
export type IpvgoBoardSize = (typeof IPVGO_BOARD_SIZES)[number]

export const IPVGO_DEFAULT_ITERATIONS = 4000

/** KataGo maxVisits presets selectable in the tail UI (100-20000). */
export const IPVGO_ITERATION_PRESETS = [
  100, 200, 300, 500, 700, 1000, 1500, 2000, 2500, 3000, 4000,
  5000, 6000, 7000, 8000, 10000, 12000, 14000, 16000, 18000, 20000,
] as const

/** Presets per row in the Sims setup table. */
export const IPVGO_ITERATIONS_PER_TABLE_ROW = 11

export const IPVGO_OPPONENTS: GoOpponent[] = [
  "Netburners",
  "Slum Snakes",
  "The Black Hand",
  "Tetrads",
  "Daedalus",
  "Illuminati",
]

export const IPVGO_KOMI_BY_OPPONENT: Record<string, number> = {
  "No AI": 5.5,
  Netburners: 1.5,
  "Slum Snakes": 3.5,
  "The Black Hand": 3.5,
  Tetrads: 5.5,
  Daedalus: 5.5,
  Illuminati: 7.5,
  "????????????": 9.5,
}

/** IPvGO subnet reward type per faction (matches in-game opponentDetails). */
export const IPVGO_BONUS_LABEL: Record<string, string> = {
  Netburners: "hacknet production",
  "Slum Snakes": "crime success",
  "The Black Hand": "hack money",
  Tetrads: "combat stats",
  Daedalus: "reputation",
  Illuminati: "hack/grow/weaken",
  "????????????": "hack level",
}
