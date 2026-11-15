import type { GoOpponent } from "@ns"

export type IpvgoBoard = string[]
export type IpvgoColor = "X" | "O"

export type IpvgoMove = { type: "move"; x: number; y: number } | { type: "pass" }

export type IpvgoValidMoves = boolean[][]

/**
 * Search settings for one move, mirroring the bench Run pane. The engine prices every
 * option from these, so the in-game script and the bench play the same game.
 */
export type IpvgoSearchSettings = {
  /** Nodes per move (the bench "Node budget"). */
  iterations: number
  /** Root beam width: Black's moves kept inside the tree. */
  beam: number
  /** White replies kept per node. */
  whiteChildren: number
  /** Fraction of White's reply probability the kept replies cover. */
  whiteMass: number
  /** Empty points at which the endgame is solved exactly. */
  endgameEmpties: number
  /** Node cap for that exact endgame solve. */
  nodeBudget: number
  /** Ceiling for iterative deepening. */
  maxDepth: number
  /** Search threads; 0 = all CPU cores. */
  threads: number
  /** Reuse exact search results across the moves of a game. */
  carry: boolean
  /** Check the played move against White's whole reply model at the first ply. */
  verifyRootReplies: boolean
  /** Let the engine value (and play) the ns.go.cheat moves. */
  cheats: boolean
  /** Cheat attempts already spent this game. */
  cheatCount: number
  /** How much better than the best legal move a cheat has to be. */
  cheatMargin: number
  /** Attempts a game may spend; 0 never cheats. */
  cheatMaxAttempts: number
  /** Require the position to be lost before an attempt is spent. */
  cheatLosingGate: boolean
  /** Player.mults.crime_success, part of the cheat success chance. */
  crimeSuccessMult: number
  /** Source-File 14 level; 3 adds the flat +25 points. */
  sourceFile14Level: number
}

export type IpvgoMoveRequest = {
  board: IpvgoBoard
  history: IpvgoBoard[]
  komi: number
  playAs: IpvgoColor
  /** Authoritative legal moves from ns.go.analysis.getValidMoves() for the root position. */
  validMoves: IpvgoValidMoves
  /**
   * Consecutive passes so far. Two passes end the game, and with one pass a decided game ends
   * on a pass, so the engine cannot infer this from the board.
   */
  passCount?: number
  /** Optional client id; echoed back for cancel/terminate. */
  requestId?: string
  /** Opponent faction; the search needs it for White's policy model. */
  opponent?: GoOpponent
  /**
   * Asks the engine what its reply model made of a move instead of searching: `board` is then
   * the position White moved in (`playAs: "O"`).
   */
  whiteReplyCheck?: { x?: number; y?: number; pass?: boolean }
} & Partial<IpvgoSearchSettings>

/** What the engine's reply model made of White's actual move. */
export type IpvgoWhiteReplyReport = {
  /** The move is in the reply distribution at all - false means the model is incomplete. */
  modelled: boolean
  /** Its probability there, 0 when absent. */
  prob: number
  /** 0-based position in the distribution, -1 when absent. */
  rank: number
  /** Replies the distribution has. */
  modelledCount: number
  /** Inside the part of the distribution the search actually searches. */
  kept: boolean
  /** Replies the search keeps. */
  keptCount: number
  /** Probability mass those kept replies cover. */
  coveredMass: number
  pass: boolean
  x: number
  y: number
}

/** The engine's cheat preference, in its own kinds: 1 remove, 2 two moves, 3 destroy, 4 repair. */
export type IpvgoCheatProposal = {
  kind: number
  x1: number
  y1: number
  x2: number
  y2: number
  /** Risk-adjusted value of the attempt. */
  value: number
  /** The game's success chance for the attempt that would come next. */
  successChance: number
  /** The best legal move's value, and the static eval of the position as it stands. */
  bestMoveValue: number
  currentValue: number
  /** Why it was or was not taken: "value" when it was played. */
  reason: string
}

export type IpvgoMoveResponse = {
  move: IpvgoMove
  /** Older engines reported iterations; the exploiter reports nodes. */
  iterations?: number
  nodes?: number
  /** Search value of the chosen move, i.e. its probability of winning. */
  value?: number
  /** Deepest ply the node budget reached. */
  depth?: number
  elapsedMs: number
  /** The answer was computed while the opponent was still replying. */
  ponderHit?: boolean
  /** The search would rather cheat than play any legal move. */
  cheatPreferred?: boolean
  cheat?: IpvgoCheatProposal
}

export const IPVGO_BOARD_SIZES = [5, 7, 9, 13] as const
export type IpvgoBoardSize = (typeof IPVGO_BOARD_SIZES)[number]

export const IPVGO_DEFAULT_ITERATIONS = 10000

/**
 * The hidden faction. Its name is masked in the game, it plays on a fixed 19x19 subnet with
 * komi 9.5 and is not part of the 5x5-13x13 rotation, so it is tunable but never auto-picked.
 */
export const IPVGO_HIDDEN_OPPONENT: GoOpponent = "????????????"

export const IPVGO_OPPONENTS: GoOpponent[] = [
  "Netburners",
  "Slum Snakes",
  "The Black Hand",
  "Tetrads",
  "Daedalus",
  "Illuminati",
  IPVGO_HIDDEN_OPPONENT,
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
