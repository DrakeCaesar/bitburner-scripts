import type { GoOpponent } from "@ns"

export type IpvgoStone = "X" | "O" | "." | "#"
export type IpvgoBoard = string[]
export type IpvgoColor = "X" | "O"

export type IpvgoMove = { type: "move"; x: number; y: number } | { type: "pass" }

export type IpvgoWorkerRequest = {
  board: IpvgoBoard
  history: IpvgoBoard[]
  komi: number
  iterations: number
  playAs: IpvgoColor
}

export type IpvgoWorkerResponse = {
  move: IpvgoMove
  iterations: number
  elapsedMs: number
}

export const IPVGO_BOARD_SIZES = [5, 7, 9, 13] as const
export type IpvgoBoardSize = (typeof IPVGO_BOARD_SIZES)[number]

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
