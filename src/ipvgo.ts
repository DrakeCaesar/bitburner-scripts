import { NS, type GoOpponent } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  createIpvgoWorker,
  requestIpvgoMove,
  verifyIpvgoWorker,
} from "./libraries/ipvgo/createWorker.js"
import {
  IPVGO_BOARD_SIZES,
  IPVGO_KOMI_BY_OPPONENT,
  IPVGO_OPPONENTS,
  type IpvgoBoardSize,
  type IpvgoMove,
} from "./libraries/ipvgo/types.js"

const SCRIPT_NAME = "ipvgo.js"
const DEFAULT_ITERATIONS = 4000
const DEFAULT_BOARD_SIZE: IpvgoBoardSize = 7
const DEFAULT_OPPONENT: GoOpponent = "Netburners"
const LOOP_SLEEP_MS = 50

function parseOpponent(value: string | undefined): GoOpponent {
  if (!value) return DEFAULT_OPPONENT
  const match = IPVGO_OPPONENTS.find((name) => name.toLowerCase() === value.toLowerCase())
  if (!match) {
    throw new Error(`Unknown opponent "${value}". Valid: ${IPVGO_OPPONENTS.join(", ")}`)
  }
  return match
}

function parseBoardSize(value: string | number | undefined): IpvgoBoardSize {
  const size = Number(value ?? DEFAULT_BOARD_SIZE)
  if (!IPVGO_BOARD_SIZES.includes(size as IpvgoBoardSize)) {
    throw new Error(`Invalid board size ${size}. Valid: ${IPVGO_BOARD_SIZES.join(", ")}`)
  }
  return size as IpvgoBoardSize
}

function parseIterations(value: string | number | undefined): number {
  const iterations = Number(value ?? DEFAULT_ITERATIONS)
  if (!Number.isFinite(iterations) || iterations < 100) {
    throw new Error(`Iterations must be a number >= 100 (got ${value})`)
  }
  return Math.floor(iterations)
}

function formatMove(move: IpvgoMove): string {
  return move.type === "pass" ? "pass" : `${move.x},${move.y}`
}

function formatOpponentTurn(result: { type: string; x: number | null; y: number | null }): string {
  if (result.type === "pass") return "opponent passed"
  if (result.type === "move" && result.x !== null && result.y !== null) {
    return `opponent played ${result.x},${result.y}`
  }
  return `opponent response: ${result.type}`
}

function logStatus(ns: NS, message: string): void {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false })
  ns.print(`[${time}] ${message}`)
}

function logGameState(ns: NS, label: string): void {
  const gameState = ns.go.getGameState()
  const player = ns.go.getCurrentPlayer()
  const opponent = ns.go.getOpponent()
  logStatus(
    ns,
    `${label} | turn:${player} vs:${opponent} score B:${gameState.blackScore.toFixed(1)} W:${gameState.whiteScore.toFixed(1)}`
  )
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  ns.ui.openTail()
  ns.ui.setTailTitle("IPvGO Bot")

  await killOtherInstances(ns)

  const opponent = parseOpponent(ns.args[0] as string | undefined)
  const boardSize = parseBoardSize(ns.args[1] as string | number | undefined)
  const iterations = parseIterations(ns.args[2] as string | number | undefined)
  const autoReset = ns.args.includes("auto")

  logStatus(ns, "IPvGO MCTS bot starting")
  ns.print(`Opponent: ${opponent}`)
  ns.print(`Board: ${boardSize}x${boardSize}`)
  ns.print(`Iterations/move: ${iterations}`)
  ns.print(`Auto reset: ${autoReset ? "on" : "off"}`)
  ns.print(`Usage: run ${SCRIPT_NAME} [opponent] [boardSize] [iterations] [auto]`)
  ns.print("")

  let worker: Worker
  try {
    worker = createIpvgoWorker(ns)
    logStatus(ns, "Worker loaded, running smoke test...")
    const smoke = await verifyIpvgoWorker(worker)
    logStatus(
      ns,
      `Worker OK (smoke move ${formatMove(smoke.move)}, ${smoke.iterations} sims, ${smoke.elapsedMs.toFixed(0)}ms)`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ns.print(`ERROR: ${message}`)
    return
  }

  let moveNumber = 0
  let gamesPlayed = 0

  while (true) {
    try {
      const currentOpponent = ns.go.getOpponent()
      const currentPlayer = ns.go.getCurrentPlayer()

      if (currentOpponent !== opponent || currentPlayer === "None") {
        if (!autoReset && currentPlayer === "None") {
          logStatus(ns, "Game over. Pass 'auto' to start another subnet.")
          break
        }
        logStatus(ns, `Resetting subnet (${boardSize}x${boardSize} vs ${opponent})...`)
        ns.go.resetBoardState(opponent, boardSize)
        gamesPlayed++
        moveNumber = 0
        logGameState(ns, `Game ${gamesPlayed} started`)
        await ns.sleep(LOOP_SLEEP_MS)
        continue
      }

      if (currentPlayer !== "Black") {
        logStatus(ns, `Waiting for opponent (${currentPlayer})...`)
        const waitResult = await ns.go.opponentNextTurn(false)
        if (waitResult.type === "gameOver") {
          logGameEnd(ns, opponent)
          if (!autoReset) break
          await ns.sleep(500)
          continue
        }
        logStatus(ns, formatOpponentTurn(waitResult))
        logGameState(ns, "After opponent")
        await ns.sleep(LOOP_SLEEP_MS)
        continue
      }

      const board = ns.go.getBoardState()
      const history = ns.go.getMoveHistory()
      const gameState = ns.go.getGameState()
      const komi = gameState.komi || IPVGO_KOMI_BY_OPPONENT[opponent] || 5.5
      moveNumber++

      logStatus(
        ns,
        `Move ${moveNumber}: thinking (${iterations} sims, ${history.length} prior boards, komi ${komi})...`
      )

      const started = performance.now()
      const analysis = await requestIpvgoMove(worker, {
        board,
        history,
        komi,
        iterations,
        playAs: "X",
      })
      const thinkMs = performance.now() - started

      const move = analysis.move
      logStatus(
        ns,
        `Move ${moveNumber}: play ${formatMove(move)} ` +
          `(${analysis.iterations} sims, worker ${analysis.elapsedMs.toFixed(0)}ms, total ${thinkMs.toFixed(0)}ms)`
      )

      let result
      if (move.type === "pass") {
        result = await ns.go.passTurn()
      } else {
        ns.go.analysis.highlightPoint(move.x, move.y, "hack", "MCTS")
        result = await ns.go.makeMove(move.x, move.y)
        ns.go.analysis.clearAllPointHighlights()
      }

      if (result.type === "gameOver") {
        logGameEnd(ns, opponent)
        if (!autoReset) break
        await ns.sleep(500)
        continue
      }

      if (result.type === "move" && result.x !== null && result.y !== null) {
        logStatus(ns, formatOpponentTurn(result))
      } else if (result.type === "pass") {
        logStatus(ns, "opponent passed")
      }

      logGameState(ns, "After our move")
      await ns.sleep(LOOP_SLEEP_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logStatus(ns, `ERROR: ${message}`)
      logGameState(ns, "Failed state")
      await ns.sleep(1000)
    }
  }
}

function logGameEnd(ns: NS, opponent: GoOpponent): void {
  const stats = ns.go.analysis.getStats()[opponent]
  const gameState = ns.go.getGameState()
  const won = gameState.blackScore > gameState.whiteScore
  logStatus(
    ns,
    `Game over (${won ? "WIN" : "LOSS"}). Final B:${gameState.blackScore.toFixed(1)} W:${gameState.whiteScore.toFixed(1)} ` +
      `| streak ${stats?.winStreak ?? 0}, wins ${stats?.wins ?? 0}, losses ${stats?.losses ?? 0}`
  )
}
