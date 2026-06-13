import { NS, type GoOpponent } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  isIpvgoEngineAvailable,
  requestIpvgoEngineMove,
} from "./libraries/ipvgo/engineClient.js"
import {
  createIpvgoSnapshot,
  recordGameResult,
  recordOpponentMove,
  recordOurMove,
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

const DEFAULT_ITERATIONS = 4000
const DEFAULT_BOARD_SIZE: IpvgoBoardSize = 7
const DEFAULT_OPPONENT: GoOpponent = "Netburners"
const LOOP_SLEEP_MS = 50
const ENABLE_TACTICAL_MOVES = false

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
  let snapshot = { ...createIpvgoSnapshot(opponent, boardSize, iterations, autoReset), phase: "Initializing" }
  await renderIpvgoDashboard(ns, tailLog, snapshot)

  if (!(await isIpvgoEngineAvailable())) {
    snapshot = { ...snapshot, phase: "Error: engine unavailable" }
    await renderIpvgoDashboard(ns, tailLog, snapshot)
    return
  }

  let engineLabel = "native"
  try {
    const health = (await fetch("http://localhost:3010/health").then((r) => r.json())) as { engine?: string }
    if (health.engine === "katago" || health.engine === "native") engineLabel = health.engine
  } catch {
    /* use default */
  }

  snapshot = { ...snapshot, backend: engineLabel as "katago" | "native", phase: "Ready" }
  await renderIpvgoDashboard(ns, tailLog, snapshot)

  let moveNumber = 0
  let gamesPlayed = 0

  while (true) {
    try {
      const currentOpponent = ns.go.getOpponent()
      const currentPlayer = ns.go.getCurrentPlayer()

      if (currentOpponent !== opponent || currentPlayer === "None") {
        if (!autoReset && currentPlayer === "None") {
          snapshot = { ...syncGameState(ns, snapshot), phase: "Stopped" }
          await renderIpvgoDashboard(ns, tailLog, snapshot)
          break
        }
        ns.go.resetBoardState(opponent, boardSize)
        gamesPlayed++
        moveNumber = 0
        snapshot = {
          ...syncGameState(ns, snapshot),
          gamesPlayed,
          moveNumber,
          phase: `Game ${gamesPlayed}`,
          lastOurMove: undefined,
          lastOpponentMove: undefined,
          gameMoves: [],
          thinkMs: 0,
          sims: 0,
        }
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

        const oppStarted = performance.now()
        const waitResult = await ns.go.opponentNextTurn(false)
        const oppMs = performance.now() - oppStarted
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
        snapshot = recordOpponentMove(snapshot, moveNumber, opponentMove, oppMs)
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
        snapshot = recordOurMove(snapshot, moveNumber, { type: "pass" }, { thinkMs: 0 })
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

      const tactical = ENABLE_TACTICAL_MOVES ? findTacticalMove(board, validMoves, "X") : null
      let move: IpvgoMove
      let thinkMs = 0
      let sims = 0

      if (shouldPassToEndGame(ns)) {
        move = { type: "pass" }
        snapshot = recordOurMove(snapshot, moveNumber, move, { thinkMs: 0 })
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          phase: "End game",
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)
      } else if (tactical) {
        move = tactical
        snapshot = recordOurMove(snapshot, moveNumber, move, { thinkMs: 0 })
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          phase: "Tactical move",
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot)
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
        snapshot = recordOurMove(snapshot, moveNumber, move, { thinkMs, sims })
      }

      const oppStarted = performance.now()
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

      const oppMs = performance.now() - oppStarted

      let opponentReply = ""
      if (result.type === "move" && result.x !== null && result.y !== null) {
        opponentReply = formatIpvgoPoint(result.x, result.y)
        snapshot = recordOpponentMove(snapshot, moveNumber, opponentReply, oppMs)
      } else if (result.type === "pass") {
        opponentReply = "pass"
        snapshot = recordOpponentMove(snapshot, moveNumber, opponentReply, oppMs)
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
      snapshot = { ...syncGameState(ns, snapshot), phase: `Error: ${message}`, thinking: false }
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
  return recordGameResult(
    {
      ...syncGameState(ns, snapshot),
      winStreak: stats?.winStreak ?? snapshot.winStreak,
      wins: stats?.wins ?? snapshot.wins,
      losses: stats?.losses ?? snapshot.losses,
      phase: won ? "Win" : "Loss",
    },
    won,
    gameState.blackScore,
    gameState.whiteScore
  )
}
