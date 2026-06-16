import { NS, type GoOpponent } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  isIpvgoEngineAvailable,
  requestIpvgoEngineMoveInterruptible,
} from "./libraries/ipvgo/engineClient.js"
import {
  applyIpvgoSetupChange,
  createIpvgoSnapshot,
  enrichSnapshotWithFactionConfig,
  recordGameResult,
  recordOpponentMove,
  recordOurCheat,
  recordOurMove,
  refreshFactionStats,
  renderIpvgoDashboard,
  syncDeferredSetupSnapshot,
} from "./libraries/ipvgo/display.js"
import {
  bumpFactionSimsOnLoss,
  estimateNodePowerByFaction,
  getFactionSims,
  loadFactionConfig,
  pickLowestNodePowerFaction,
  saveFactionConfig,
  setFactionSims,
  toggleFactionEnabled,
  type IpvgoFactionConfig,
} from "./libraries/ipvgo/factionConfig.js"
import {
  executeCheat,
  findCheatAction,
  readCheatStats,
  shouldAttemptCheat,
  type CheatAction,
} from "./libraries/ipvgo/cheats.js"
import {
  consumeDeferUiWake,
  consumeFactionEnabledToggle,
  consumeFactionSimsChange,
  consumeImmediateSetup,
  hasIpvgoSetupPending,
  sleepUntilIpvgoSetupChange,
  takeDeferredSetup,
} from "./libraries/ipvgo/uiControl.js"
import { findTacticalMove } from "./libraries/ipvgo/tactics.js"
import { shouldPassToEndGame } from "./libraries/ipvgo/endgame.js"
import {
  IPVGO_BOARD_SIZES,
  IPVGO_DEFAULT_ITERATIONS,
  IPVGO_KOMI_BY_OPPONENT,
  IPVGO_OPPONENTS,
  type IpvgoBoard,
  type IpvgoBoardSize,
  type IpvgoMove,
  type IpvgoValidMoves,
} from "./libraries/ipvgo/types.js"
import { formatIpvgoPoint } from "./libraries/ipvgo/coords.js"
import { isInfiltrationUiBlockingNavigation } from "./libraries/infiltration/infiltrationNavigation.js"
import { createAdaptiveTailLog, createTailLog, openTailLog } from "./libraries/scriptLogUiLayout.js"

const DEFAULT_BOARD_SIZE: IpvgoBoardSize = 7
const DEFAULT_OPPONENT: GoOpponent = "Netburners"
const LOOP_SLEEP_MS = 50
const ENABLE_TACTICAL_MOVES = true
const ENABLE_CHEATS = true

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

function parseIterations(value: string | number | undefined): number | undefined {
  if (value == null || value === "") return undefined
  const iterations = Number(value)
  if (!Number.isFinite(iterations) || iterations < 100) {
    throw new Error(`Iterations must be a number >= 100 (got ${value})`)
  }
  return Math.floor(iterations)
}

function buildAutoSetup(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  config: IpvgoFactionConfig,
  boardSize: IpvgoBoardSize
) {
  const nodePowerByFaction = estimateNodePowerByFaction(ns, snapshot.opponentStats)
  const opponent = pickLowestNodePowerFaction(nodePowerByFaction, config)
  return {
    opponent,
    boardSize,
    iterations: getFactionSims(config, opponent),
  }
}

function withFactionConfig(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  config: IpvgoFactionConfig
) {
  return enrichSnapshotWithFactionConfig(ns, refreshFactionStats(snapshot, ns), config)
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

type InProgressGame = {
  opponent: GoOpponent
  boardSize: IpvgoBoardSize
  moveNumber: number
}

/** Adopt a live IPvGO game instead of resetBoardState (abandon = loss). */
function detectInProgressGame(ns: NS): InProgressGame | null {
  if (ns.go.getCurrentPlayer() === "None") return null

  const board = ns.go.getBoardState()
  if (board.length === 0) return null

  const opponent = ns.go.getOpponent()
  if (opponent === "No AI") return null

  const boardSize = board.length
  if (!IPVGO_BOARD_SIZES.includes(boardSize as IpvgoBoardSize) && opponent !== "????????????") {
    return null
  }

  return {
    opponent,
    boardSize: boardSize as IpvgoBoardSize,
    moveNumber: Math.floor(ns.go.getMoveHistory().length / 2),
  }
}

function syncGameState(ns: NS, snapshot: ReturnType<typeof createIpvgoSnapshot>) {
  const gameState = ns.go.getGameState()
  const cheatStats = readCheatStats(ns)
  return {
    ...refreshFactionStats(snapshot, ns),
    currentPlayer: ns.go.getCurrentPlayer(),
    komi: gameState.komi || IPVGO_KOMI_BY_OPPONENT[snapshot.opponent] || 5.5,
    blackScore: gameState.blackScore,
    whiteScore: gameState.whiteScore,
    board: ns.go.getBoardState(),
    cheatAvailable: cheatStats.available,
    cheatCount: cheatStats.count,
    cheatSuccessChance: cheatStats.successChance,
  }
}

function formatCheatLabel(action: CheatAction, succeeded: boolean, successChance: number): string {
  const point = formatIpvgoPoint(action.x, action.y)
  const verb = action.kind === "repair" ? "repair" : "remove"
  const outcome = succeeded ? "OK" : "FAIL"
  return `${verb} ${point} ${outcome} (${Math.round(successChance * 100)}%)`
}

function boardNeighbors(size: number, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (y > 0) out.push([x, y - 1])
  if (x < size - 1) out.push([x + 1, y])
  if (y < size - 1) out.push([x, y + 1])
  if (x > 0) out.push([x - 1, y])
  return out
}

/** Preview board with our stone placed (makeMove blocks until opponent replies). */
function applyOurMoveToBoard(board: IpvgoBoard, x: number, y: number): IpvgoBoard {
  const size = board.length
  const rows = board.map((row) => row.split(""))
  rows[x][y] = "X"

  const get = (cx: number, cy: number): string => rows[cx]?.[cy] ?? "."

  function collectChain(sx: number, sy: number): Array<[number, number]> {
    const chain: Array<[number, number]> = []
    const stack: Array<[number, number]> = [[sx, sy]]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!
      const key = `${cx},${cy}`
      if (seen.has(key) || get(cx, cy) !== "O") continue
      seen.add(key)
      chain.push([cx, cy])
      for (const [nx, ny] of boardNeighbors(size, cx, cy)) {
        if (!seen.has(`${nx},${ny}`) && get(nx, ny) === "O") stack.push([nx, ny])
      }
    }
    return chain
  }

  function chainLiberties(chain: Array<[number, number]>): number {
    const liberties = new Set<string>()
    for (const [cx, cy] of chain) {
      for (const [nx, ny] of boardNeighbors(size, cx, cy)) {
        if (get(nx, ny) === ".") liberties.add(`${nx},${ny}`)
      }
    }
    return liberties.size
  }

  for (const [nx, ny] of boardNeighbors(size, x, y)) {
    if (get(nx, ny) !== "O") continue
    const chain = collectChain(nx, ny)
    if (chainLiberties(chain) === 0) {
      for (const [cx, cy] of chain) rows[cx][cy] = "."
    }
  }

  return rows.map((row) => row.join(""))
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  openTailLog(ns, "IPvGO Bot")

  await killOtherInstances(ns)

  const opponent = parseOpponent(ns.args[0] as string | undefined)
  const boardSize = parseBoardSize(ns.args[1] as string | number | undefined)
  const argIterations = parseIterations(ns.args[2] as string | number | undefined)

  let factionConfig = loadFactionConfig(ns)

  const inProgress = detectInProgressGame(ns)
  let activeOpponent = inProgress?.opponent ?? opponent
  let activeBoardSize = inProgress?.boardSize ?? boardSize

  if (argIterations != null) {
    factionConfig = setFactionSims(factionConfig, activeOpponent, argIterations)
    saveFactionConfig(ns, factionConfig)
  }

  const adaptiveLog = createAdaptiveTailLog(createTailLog(), {
    windowId: "ipvgo-script-log",
    title: "IPvGO Bot",
    shouldUseFloating: isInfiltrationUiBlockingNavigation,
  })
  const tailLog = adaptiveLog.log
  ns.atExit(() => adaptiveLog.dispose())

  if (!inProgress) {
    const autoSetup = buildAutoSetup(
      ns,
      createIpvgoSnapshot(activeOpponent, activeBoardSize, IPVGO_DEFAULT_ITERATIONS),
      factionConfig,
      activeBoardSize
    )
    activeOpponent = autoSetup.opponent
  }

  const initialIterations = getFactionSims(factionConfig, activeOpponent)
  const baseSnapshot = createIpvgoSnapshot(activeOpponent, activeBoardSize, initialIterations)
  let snapshot = withFactionConfig(
    ns,
    inProgress
      ? {
          ...syncGameState(ns, baseSnapshot),
          phase: `Resumed ${activeOpponent} ${activeBoardSize}x${activeBoardSize}`,
        }
      : { ...baseSnapshot, phase: "Initializing" },
    factionConfig
  )
  let pendingGameResult: boolean | null = null
  await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

  if (!(await isIpvgoEngineAvailable())) {
    snapshot = { ...snapshot, phase: "Error: engine unavailable" }
    await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
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
  await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

  let moveNumber = inProgress?.moveNumber ?? 0
  let gamesPlayed = 0

  gameLoop: while (true) {
    try {
      const immediate = consumeImmediateSetup()
      if (immediate) {
        const setupApplied = applyIpvgoSetupChange(ns, snapshot, immediate, { forceReset: true })
        snapshot = withFactionConfig(ns, setupApplied.snapshot, factionConfig)
        activeOpponent = snapshot.opponent
        activeBoardSize = snapshot.boardSize as IpvgoBoardSize
        moveNumber = snapshot.moveNumber
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        continue
      }

      const simsChange = consumeFactionSimsChange()
      if (simsChange) {
        factionConfig = setFactionSims(factionConfig, simsChange.faction, simsChange.iterations)
        saveFactionConfig(ns, factionConfig)
        const pending =
          simsChange.faction === snapshot.opponent
            ? {
                opponent: snapshot.opponent,
                boardSize: snapshot.boardSize as IpvgoBoardSize,
                iterations: simsChange.iterations,
              }
            : null
        if (pending) {
          const setupApplied = applyIpvgoSetupChange(ns, snapshot, pending)
          snapshot = withFactionConfig(ns, setupApplied.snapshot, factionConfig)
          if (setupApplied.changed) {
            await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
            continue
          }
        }
        snapshot = withFactionConfig(ns, snapshot, factionConfig)
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        continue
      }

      const enabledToggle = consumeFactionEnabledToggle()
      if (enabledToggle) {
        factionConfig = toggleFactionEnabled(factionConfig, enabledToggle)
        saveFactionConfig(ns, factionConfig)
        snapshot = withFactionConfig(ns, snapshot, factionConfig)
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        continue
      }

      const syncedDeferred = syncDeferredSetupSnapshot(snapshot)
      if (syncedDeferred !== snapshot) {
        consumeDeferUiWake()
        snapshot = syncedDeferred
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        continue
      }
      consumeDeferUiWake()

      const currentOpponent = ns.go.getOpponent()
      const currentPlayer = ns.go.getCurrentPlayer()
      const liveBoardSize = ns.go.getBoardState().length as IpvgoBoardSize

      if (currentPlayer === "None") {
        if (pendingGameResult === false) {
          factionConfig = bumpFactionSimsOnLoss(factionConfig, activeOpponent)
          saveFactionConfig(ns, factionConfig)
        }
        pendingGameResult = null

        const deferred = takeDeferredSetup()
        if (deferred) {
          const setupApplied = applyIpvgoSetupChange(ns, snapshot, deferred)
          snapshot = withFactionConfig(ns, setupApplied.snapshot, factionConfig)
          activeOpponent = snapshot.opponent
          activeBoardSize = snapshot.boardSize as IpvgoBoardSize
        } else {
          snapshot = withFactionConfig(ns, refreshFactionStats(snapshot, ns), factionConfig)
          const autoSetup = buildAutoSetup(ns, snapshot, factionConfig, activeBoardSize)
          const setupApplied = applyIpvgoSetupChange(ns, snapshot, autoSetup)
          snapshot = withFactionConfig(ns, setupApplied.snapshot, factionConfig)
          activeOpponent = snapshot.opponent
          activeBoardSize = snapshot.boardSize as IpvgoBoardSize
        }
        gamesPlayed++
        moveNumber = 0
        snapshot = {
          ...snapshot,
          gamesPlayed,
          moveNumber,
          phase: `Game ${gamesPlayed}`,
          lastOurMove: undefined,
          lastOpponentMove: undefined,
          gameMoves: [],
          thinkMs: 0,
          sims: 0,
          deferredSetup: undefined,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        await sleepUntilIpvgoSetupChange(ns, LOOP_SLEEP_MS)
        continue
      }

      if (currentOpponent !== activeOpponent || liveBoardSize !== activeBoardSize) {
        activeOpponent = currentOpponent
        activeBoardSize = liveBoardSize
        snapshot = {
          ...syncGameState(ns, snapshot),
          opponent: activeOpponent,
          boardSize: activeBoardSize,
          moveNumber,
          phase: `Synced ${activeOpponent} ${activeBoardSize}x${activeBoardSize}`,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
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
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

        const oppStarted = performance.now()
        const waitResult = await ns.go.opponentNextTurn(false)
        const oppMs = performance.now() - oppStarted
        if (waitResult.type === "gameOver") {
          snapshot = logGameEnd(ns, snapshot, activeOpponent, (won) => {
            pendingGameResult = won
          })
          await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
          await sleepUntilIpvgoSetupChange(ns, 500)
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
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        await sleepUntilIpvgoSetupChange(ns, LOOP_SLEEP_MS)
        continue
      }

      const board = ns.go.getBoardState()
      const history = ns.go.getMoveHistory()
      const gameState = ns.go.getGameState()
      const komi = gameState.komi || IPVGO_KOMI_BY_OPPONENT[activeOpponent] || 5.5
      const validMoves = ns.go.analysis.getValidMoves()
      const legalCount = countValidMoves(validMoves)
      moveNumber++

      if (ENABLE_CHEATS) {
        const cheatStats = readCheatStats(ns)
        const cheatAction = shouldAttemptCheat(cheatStats) ? findCheatAction(board, validMoves) : null
        if (cheatAction) {
          snapshot = {
            ...syncGameState(ns, snapshot),
            moveNumber,
            legalCount,
            validMoves,
            phase: `Cheat ${cheatAction.kind}`,
            thinking: false,
          }
          await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

          ns.go.analysis.highlightPoint(cheatAction.x, cheatAction.y, "hack", cheatAction.kind)
          const cheatStarted = performance.now()
          const { result: cheatResult, succeeded } = await executeCheat(ns, cheatAction, board)
          ns.go.analysis.clearAllPointHighlights()
          const cheatMs = performance.now() - cheatStarted
          const cheatLabel = formatCheatLabel(cheatAction, succeeded, cheatStats.successChance)

          snapshot = recordOurCheat(snapshot, moveNumber, cheatLabel, cheatMs)

          if (cheatResult.type === "gameOver") {
            snapshot = logGameEnd(ns, snapshot, activeOpponent, (won) => {
            pendingGameResult = won
          })
            await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
            await sleepUntilIpvgoSetupChange(ns, 500)
            continue
          }

          let opponentReply = ""
          if (cheatResult.type === "move" && cheatResult.x !== null && cheatResult.y !== null) {
            opponentReply = formatIpvgoPoint(cheatResult.x, cheatResult.y)
            snapshot = recordOpponentMove(snapshot, moveNumber, opponentReply)
          } else if (cheatResult.type === "pass") {
            opponentReply = "pass"
            snapshot = recordOpponentMove(snapshot, moveNumber, opponentReply)
          }

          const ourMove: IpvgoMove = { type: "move", x: cheatAction.x, y: cheatAction.y }
          snapshot = {
            ...syncGameState(ns, snapshot),
            moveNumber,
            legalCount,
            validMoves: undefined,
            lastOurMove: ourMove,
            lastOpponentMove: opponentReply || snapshot.lastOpponentMove,
            thinkMs: 0,
            sims: 0,
            thinking: false,
            phase: succeeded ? "Cheat succeeded" : "Cheat failed",
          }
          await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
          await sleepUntilIpvgoSetupChange(ns, LOOP_SLEEP_MS)
          continue
        }
      }

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
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

        const passResult = await ns.go.passTurn()
        if (passResult.type === "gameOver") {
          snapshot = logGameEnd(ns, snapshot, activeOpponent, (won) => {
            pendingGameResult = won
          })
        }
        snapshot = syncGameState(ns, snapshot)
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        await sleepUntilIpvgoSetupChange(ns, LOOP_SLEEP_MS)
        continue
      }

      const tactical = ENABLE_TACTICAL_MOVES ? findTacticalMove(board, validMoves, "X") : null
      let move: IpvgoMove
      let thinkMs = 0
      let sims = 0

      if (shouldPassToEndGame(ns)) {
        move = { type: "pass" }
        snapshot = recordOurMove(snapshot, moveNumber, move, { thinkMs: 0 })
      } else if (tactical) {
        move = tactical
        snapshot = recordOurMove(snapshot, moveNumber, move, { thinkMs: 0 })
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
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

        const started = performance.now()
        const request = {
          board,
          history,
          komi,
          iterations: snapshot.iterations,
          playAs: "X" as const,
          validMoves,
        }
        const analysis = await requestIpvgoEngineMoveInterruptible(
          request,
          hasIpvgoSetupPending,
          (ms) => ns.sleep(ms)
        )
        if (!analysis) {
          snapshot = {
            ...snapshot,
            thinking: false,
            phase: "Setup changed",
          }
          await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
          continue gameLoop
        }
        thinkMs = performance.now() - started
        sims = analysis.iterations

        const suggested = analysis.move
        move = pickLegalMove(validMoves, suggested)
        snapshot = recordOurMove(snapshot, moveNumber, move, { thinkMs, sims })
      }

      const synced = syncGameState(ns, snapshot)
      snapshot = {
        ...synced,
        board: move.type === "move" ? applyOurMoveToBoard(synced.board, move.x, move.y) : synced.board,
        moveNumber,
        legalCount,
        validMoves: undefined,
        lastOurMove: move,
        thinkMs,
        sims,
        thinking: false,
      }
      await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

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
        snapshot = logGameEnd(ns, snapshot, activeOpponent, (won) => {
          pendingGameResult = won
        })
        snapshot = {
          ...snapshot,
          lastOurMove: move,
          thinkMs,
          sims,
          thinking: false,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
        await sleepUntilIpvgoSetupChange(ns, 500)
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
      await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
      await sleepUntilIpvgoSetupChange(ns, LOOP_SLEEP_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      snapshot = { ...syncGameState(ns, snapshot), phase: `Error: ${message}`, thinking: false }
      await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
      await sleepUntilIpvgoSetupChange(ns, 1000)
    }
  }
}

function logGameEnd(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  _opponent: GoOpponent,
  onResult?: (won: boolean) => void
) {
  const gameState = ns.go.getGameState()
  const won = gameState.blackScore > gameState.whiteScore
  onResult?.(won)
  return recordGameResult(
    {
      ...syncGameState(ns, snapshot),
      phase: won ? "Win" : "Loss",
    },
    won,
    gameState.blackScore,
    gameState.whiteScore
  )
}
