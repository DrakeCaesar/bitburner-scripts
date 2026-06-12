import { NS, type GoOpponent } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  isIpvgoEngineAvailable,
  requestIpvgoEngineMove,
} from "./libraries/ipvgo/engineClient.js"
import {
  appendIpvgoLog,
  createIpvgoSnapshot,
  refreshFactionStats,
  renderIpvgoDashboard,
} from "./libraries/ipvgo/display.js"
import { findTacticalMove } from "./libraries/ipvgo/tactics.js"
import { shouldPassToEndGame } from "./libraries/ipvgo/endgame.js"
import {
  IPVGO_BOARD_SIZES,
  IPVGO_KOMI_BY_OPPONENT,
  IPVGO_OPPONENTS,
  type IpvgoBoardSize,
  type IpvgoMove,
  type IpvgoValidMoves,
} from "./libraries/ipvgo/types.js"
import { formatIpvgoPoint } from "./libraries/ipvgo/coords.js"
import { createTailLog, openTailLog } from "./libraries/scriptLogUiLayout.js"

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
  return move.type === "pass" ? "pass" : formatIpvgoPoint(move.x, move.y)
}

function countValidMoves(validMoves: IpvgoValidMoves): number {
  let count = 0
  for (const column of validMoves) {
    for (const isValid of column) {
      if (isValid) count++
    }
  }
  return count
}

function pickLegalMove(validMoves: IpvgoValidMoves, preferred?: IpvgoMove): IpvgoMove {
  if (preferred?.type === "move" && validMoves[preferred.x]?.[preferred.y] === true) {
    return preferred
  }

  const options: Array<[number, number]> = []
  for (let x = 0; x < validMoves.length; x++) {
    for (let y = 0; y < validMoves[x].length; y++) {
      if (validMoves[x][y]) options.push([x, y])
    }
  }

  if (options.length === 0) return { type: "pass" }
  const [x, y] = options[Math.floor(Math.random() * options.length)]
  return { type: "move", x, y }
}

function formatOpponentTurn(result: { type: string; x: number | null; y: number | null }): string {
  if (result.type === "pass") return "pass"
  if (result.type === "move" && result.x !== null && result.y !== null) {
    return formatIpvgoPoint(result.x, result.y)
  }
  return result.type
}

function syncGameState(ns: NS, snapshot: ReturnType<typeof createIpvgoSnapshot>) {
  const gameState = ns.go.getGameState()
  return {
    ...refreshFactionStats(snapshot, ns),
    currentPlayer: ns.go.getCurrentPlayer(),
    komi: gameState.komi || IPVGO_KOMI_BY_OPPONENT[snapshot.opponent] || 5.5,
    blackScore: gameState.blackScore,
    whiteScore: gameState.whiteScore,
    board: ns.go.getBoardState(),
  }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  openTailLog(ns, "IPvGO Bot")

  await killOtherInstances(ns)

  const opponent = parseOpponent(ns.args[0] as string | undefined)
  const boardSize = parseBoardSize(ns.args[1] as string | number | undefined)
  const iterations = parseIterations(ns.args[2] as string | number | undefined)
  const autoReset = ns.args.includes("auto")

  const tailLog = createTailLog()
  let snapshot = appendIpvgoLog(
    createIpvgoSnapshot(opponent, boardSize, iterations, autoReset),
    "IPvGO MCTS bot starting"
  )
  snapshot = appendIpvgoLog(
    snapshot,
    `Usage: run ${SCRIPT_NAME} [opponent] [boardSize] [iterations] [auto]`
  )
  snapshot = appendIpvgoLog(snapshot, "Requires native engine: pnpm run server (from repo root)")
  snapshot = { ...snapshot, phase: "Initializing" }
  await renderIpvgoDashboard(ns, tailLog, snapshot)

  if (!(await isIpvgoEngineAvailable())) {
    snapshot = appendIpvgoLog(
      snapshot,
      "ERROR: native engine unavailable. Run: pnpm run server (from repo root)"
    )
    snapshot = { ...snapshot, phase: "Error" }
    await renderIpvgoDashboard(ns, tailLog, snapshot)
    return
  }

  snapshot = appendIpvgoLog(snapshot, "Native engine ready (localhost:3010)")
  snapshot = { ...snapshot, backend: "native", phase: "Ready" }
  await renderIpvgoDashboard(ns, tailLog, snapshot)

  let moveNumber = 0
  let gamesPlayed = 0

  while (true) {
    try {
      const currentOpponent = ns.go.getOpponent()
      const currentPlayer = ns.go.getCurrentPlayer()

      if (currentOpponent !== opponent || currentPlayer === "None") {
        if (!autoReset && currentPlayer === "None") {
          snapshot = appendIpvgoLog(snapshot, "Game over. Pass 'auto' to start another subnet.")
          snapshot = { ...syncGameState(ns, snapshot), phase: "Stopped" }
          await renderIpvgoDashboard(ns, tailLog, snapshot)
          break
        }
        snapshot = appendIpvgoLog(snapshot, `Resetting subnet (${boardSize}x${boardSize} vs ${opponent})...`)
        ns.go.resetBoardState(opponent, boardSize)
        gamesPlayed++
        moveNumber = 0
        snapshot = {
          ...syncGameState(ns, snapshot),
          gamesPlayed,
          moveNumber,
          phase: "New game",
          lastOurMove: undefined,
          lastOpponentMove: undefined,
          thinkMs: 0,
          sims: 0,
        }
        snapshot = appendIpvgoLog(
          snapshot,
          `Game ${gamesPlayed} started | B:${snapshot.blackScore.toFixed(1)} W:${snapshot.whiteScore.toFixed(1)}`
        )
        await renderIpvgoDashboard(ns, tailLog, snapshot)
        await ns.sleep(LOOP_SLEEP_MS)
        continue
      }

      if (currentPlayer !== "Black") {
        snapshot = {
          ...syncGameState(ns, snapshot),
          phase: `Waiting (${currentPlayer})`,
          moveNumber,
          thinking: false,
          validMoves: undefined,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)

        const waitResult = await ns.go.opponentNextTurn(false)
        if (waitResult.type === "gameOver") {
          snapshot = logGameEnd(ns, snapshot, opponent)
          if (!autoReset) {
            await renderIpvgoDashboard(ns, tailLog, snapshot)
            break
          }
          await renderIpvgoDashboard(ns, tailLog, snapshot)
          await ns.sleep(500)
          continue
        }

        const opponentMove = formatOpponentTurn(waitResult)
        snapshot = appendIpvgoLog(snapshot, `Opponent: ${opponentMove}`)
        snapshot = {
          ...syncGameState(ns, snapshot),
          lastOpponentMove: opponentMove,
          phase: "Opponent moved",
          moveNumber,
          validMoves: undefined,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)
        await ns.sleep(LOOP_SLEEP_MS)
        continue
      }

      const board = ns.go.getBoardState()
      const history = ns.go.getMoveHistory()
      const gameState = ns.go.getGameState()
      const komi = gameState.komi || IPVGO_KOMI_BY_OPPONENT[opponent] || 5.5
      const validMoves = ns.go.analysis.getValidMoves()
      const legalCount = countValidMoves(validMoves)
      moveNumber++

      if (legalCount === 0) {
        snapshot = appendIpvgoLog(snapshot, `Move ${moveNumber}: no legal plays, passing`)
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          phase: "Passing",
          thinking: false,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)

        const passResult = await ns.go.passTurn()
        if (passResult.type === "gameOver") {
          snapshot = logGameEnd(ns, snapshot, opponent)
          if (!autoReset) {
            await renderIpvgoDashboard(ns, tailLog, snapshot)
            break
          }
        }
        snapshot = syncGameState(ns, snapshot)
        await renderIpvgoDashboard(ns, tailLog, snapshot)
        await ns.sleep(LOOP_SLEEP_MS)
        continue
      }

      const tactical = findTacticalMove(board, validMoves, "X")
      let move: IpvgoMove
      let thinkMs = 0
      let sims = 0

      if (shouldPassToEndGame(ns, snapshot.lastOpponentMove)) {
        move = { type: "pass" }
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          phase: "End game",
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)
        snapshot = appendIpvgoLog(snapshot, `Move ${moveNumber}: pass (end game)`)
      } else if (tactical) {
        move = tactical
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          phase: "Tactical move",
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)
        snapshot = appendIpvgoLog(snapshot, `Move ${moveNumber}: tactical ${formatMove(move)}`)
      } else {
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          thinking: true,
          phase: "Thinking",
          thinkMs: 0,
          sims: 0,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)

        const started = performance.now()
        const request = {
          board,
          history,
          komi,
          iterations,
          playAs: "X" as const,
          validMoves,
        }
        const analysis = await requestIpvgoEngineMove(request)
        thinkMs = performance.now() - started
        sims = analysis.iterations

        const suggested = analysis.move
        move = pickLegalMove(validMoves, suggested)
        if (
          suggested.type === "move" &&
          (move.type === "pass" || move.x !== suggested.x || move.y !== suggested.y)
        ) {
          snapshot = appendIpvgoLog(
            snapshot,
            `Move ${moveNumber}: engine illegal ${formatMove(suggested)}, using ${formatMove(move)}`
          )
        }

        snapshot = appendIpvgoLog(
          snapshot,
          `Move ${moveNumber}: play ${formatMove(move)} (${sims} sims, ${thinkMs.toFixed(0)}ms)`
        )
      }

      let result
      if (move.type === "pass") {
        result = await ns.go.passTurn()
      } else {
        ns.go.analysis.highlightPoint(move.x, move.y, "hack", "MCTS")
        result = await ns.go.makeMove(move.x, move.y)
        ns.go.analysis.clearAllPointHighlights()
      }

      if (result.type === "gameOver") {
        snapshot = logGameEnd(ns, snapshot, opponent)
        snapshot = {
          ...snapshot,
          lastOurMove: move,
          thinkMs,
          sims,
          thinking: false,
        }
        if (!autoReset) {
          await renderIpvgoDashboard(ns, tailLog, snapshot)
          break
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)
        await ns.sleep(500)
        continue
      }

      let opponentReply = ""
      if (result.type === "move" && result.x !== null && result.y !== null) {
        opponentReply = formatIpvgoPoint(result.x, result.y)
        snapshot = appendIpvgoLog(snapshot, `Opponent: ${opponentReply}`)
      } else if (result.type === "pass") {
        opponentReply = "pass"
        snapshot = appendIpvgoLog(snapshot, "Opponent: pass")
      }

      snapshot = {
        ...syncGameState(ns, snapshot),
        moveNumber,
        legalCount,
        validMoves: undefined,
        lastOurMove: move,
        lastOpponentMove: opponentReply || snapshot.lastOpponentMove,
        thinkMs,
        sims,
        thinking: false,
        phase: "Our move played",
      }
      await renderIpvgoDashboard(ns, tailLog, snapshot)
      await ns.sleep(LOOP_SLEEP_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      snapshot = appendIpvgoLog(snapshot, `ERROR: ${message}`)
      snapshot = { ...syncGameState(ns, snapshot), phase: "Error", thinking: false }
      await renderIpvgoDashboard(ns, tailLog, snapshot)
      await ns.sleep(1000)
    }
  }
}

function logGameEnd(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  opponent: GoOpponent
) {
  const stats = ns.go.analysis.getStats()[opponent]
  const gameState = ns.go.getGameState()
  const won = gameState.blackScore > gameState.whiteScore
  return appendIpvgoLog(
    {
      ...syncGameState(ns, snapshot),
      winStreak: stats?.winStreak ?? snapshot.winStreak,
      wins: stats?.wins ?? snapshot.wins,
      losses: stats?.losses ?? snapshot.losses,
      phase: won ? "Win" : "Loss",
    },
    `Game over (${won ? "WIN" : "LOSS"}) B:${gameState.blackScore.toFixed(1)} W:${gameState.whiteScore.toFixed(1)} ` +
      `| streak ${stats?.winStreak ?? 0}, W ${stats?.wins ?? 0} L ${stats?.losses ?? 0}`
  )
}
