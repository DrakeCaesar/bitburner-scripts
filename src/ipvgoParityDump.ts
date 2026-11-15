import { NS } from "@ns"

/**
 * Parity data collector for the native IPvGO engine.
 *
 * Plays a series of games against each faction (making random legal moves for
 * Black) and, on every Black turn, snapshots the exact board, valid-move mask,
 * move history, komi and score reported by the game. The collected cases are
 * POSTed to the local engine server, which writes them to
 * `ipvgo-engine/temp/parity_cases.json`.
 *
 * Then run the native harness to check exact agreement:
 *   ipvgo_game.exe parity ipvgo-engine/temp/parity_cases.json
 *
 * Usage: run ipvgoParityDump.js [targetCases=200] [serverUrl]
 */

type ParityCase = {
  opponent: string
  playAs: "X"
  board: string[]
  validMoves: boolean[][]
  history: string[][]
  komi: number
  passCount: number
  score: { black: number; white: number }
}

const OPPONENTS = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"]
const SIZES = [5, 7, 9, 13]

function collectLegalMoves(validMoves: boolean[][]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let x = 0; x < validMoves.length; x++) {
    for (let y = 0; y < validMoves[x].length; y++) {
      if (validMoves[x][y]) out.push([x, y])
    }
  }
  return out
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  const target = Number(ns.args[0] ?? 200)
  const serverUrl = String(ns.args[1] ?? "http://localhost:3010/api/ipvgo/parity")

  const go = ns.go as unknown as {
    resetBoardState: (opp: string, size: number) => unknown
    getBoardState: () => string[]
    getCurrentPlayer: () => string
    getGameState: () => { komi: number; blackScore: number; whiteScore: number; passCount?: number }
    getMoveHistory: () => string[][]
    makeMove: (x: number, y: number) => Promise<{ type: string }>
    passTurn: () => Promise<{ type: string }>
    opponentNextTurn: (log: boolean) => Promise<{ type: string }>
    analysis: { getValidMoves: () => boolean[][] }
  }

  const cases: ParityCase[] = []
  let gameIndex = 0

  while (cases.length < target) {
    const opponent = OPPONENTS[gameIndex % OPPONENTS.length]
    const size = SIZES[Math.floor(Math.random() * SIZES.length)]
    gameIndex++
    go.resetBoardState(opponent, size)

    let safety = 0
    while (cases.length < target && safety++ < size * size * 2) {
      const player = go.getCurrentPlayer()
      if (player === "None") break

      if (player !== "Black") {
        const r = await go.opponentNextTurn(false)
        if (r.type === "gameOver") break
        continue
      }

      const board = go.getBoardState()
      const validMoves = go.analysis.getValidMoves()
      const gameState = go.getGameState()
      const history = go.getMoveHistory()
      cases.push({
        opponent,
        playAs: "X",
        board,
        validMoves,
        history,
        komi: gameState.komi,
        passCount: gameState.passCount ?? 0,
        score: { black: gameState.blackScore, white: gameState.whiteScore },
      })

      const options = collectLegalMoves(validMoves)
      if (options.length === 0) {
        const r = await go.passTurn()
        if (r.type === "gameOver") break
        continue
      }
      const [mx, my] = options[Math.floor(Math.random() * options.length)]
      const r = await go.makeMove(mx, my)
      if (r.type === "gameOver") break
    }

    ns.print(`collected ${cases.length}/${target} cases`)
  }

  const response = await fetch(serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cases),
  }).then((r) => r.json())

  ns.tprint(`Parity dump complete: ${JSON.stringify(response)}`)
}
