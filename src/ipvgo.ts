import { NS, type GoOpponent } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  checkIpvgoWhiteReply,
  isIpvgoEngineAvailable,
  ponderIpvgoEngine,
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
  estimateNodePowerByFaction,
  getFactionSims,
  loadFactionConfig,
  pickHighestGainFaction,
  saveFactionConfig,
  toggleFactionEnabled,
  type IpvgoFactionConfig,
} from "./libraries/ipvgo/factionConfig.js"
import {
  CHEAT_KIND_NAMES,
  playEngineCheat,
  readCheatContext,
  readCheatStats,
} from "./libraries/ipvgo/cheats.js"
import {
  consumeDeferUiWake,
  consumeFactionEnabledToggle,
  consumeImmediateSetup,
  hasIpvgoSetupPending,
  sleepUntilIpvgoSetupChange,
  takeDeferredSetup,
} from "./libraries/ipvgo/uiControl.js"
import {
  IPVGO_BOARD_SIZES,
  IPVGO_DEFAULT_ITERATIONS,
  IPVGO_KOMI_BY_OPPONENT,
  IPVGO_OPPONENTS,
  IPVGO_HIDDEN_OPPONENT,
  type IpvgoBoard,
  type IpvgoBoardSize,
  type IpvgoMove,
  type IpvgoMoveRequest,
  type IpvgoValidMoves,
} from "./libraries/ipvgo/types.js"
import { formatIpvgoPoint } from "./libraries/ipvgo/coords.js"
import { isInfiltrationUiBlockingNavigation } from "./libraries/infiltration/infiltrationNavigation.js"
import { createAdaptiveTailLog, createTailLog, openTailLog } from "./libraries/scriptLogUiLayout.js"

const DEFAULT_BOARD_SIZE: IpvgoBoardSize = 7
const DEFAULT_OPPONENT: GoOpponent = "Netburners"
const LOOP_SLEEP_MS = 50

/**
 * Search settings from the bench Run pane, so the script plays the game the bench was tuned
 * with: 5x5, node budget, endgame empties 6 / 30 000, max depth 10, all cores, carry memo,
 * verify all replies at the root, cheats on at SF14.3 with 2 attempts, margin 0.2, only while
 * losing. The per-move node budget is the per-faction Sims (10 000 by default).
 */
const IPVGO_SEARCH = {
  endgameEmpties: 6,
  endgameNodeBudget: 30000,
  maxDepth: 10,
  threads: 0,
  carry: true,
  verifyRootReplies: true,
  cheats: true,
  cheatMargin: 0.2,
  cheatMaxAttempts: 2,
  cheatLosingGate: true,
  /** Stop the script when White plays a move the engine's reply model does not contain. */
  parityCheck: true,
} as const

/** Per-faction widths from the same Run pane: beam, replies kept, reply mass cap. */
const IPVGO_FACTION_SEARCH: Record<
  string,
  { beam: number; whiteChildren: number; whiteMass: number }
> = {
  Netburners: { beam: 12, whiteChildren: 6, whiteMass: 0.9 },
  "Slum Snakes": { beam: 4, whiteChildren: 4, whiteMass: 0.76 },
  "The Black Hand": { beam: 2, whiteChildren: 6, whiteMass: 0.83 },
  Tetrads: { beam: 2, whiteChildren: 14, whiteMass: 0.4 },
  Daedalus: { beam: 2, whiteChildren: 8, whiteMass: 0.89 },
  Illuminati: { beam: 2, whiteChildren: 4, whiteMass: 0.97 },
  // The hidden faction plays on 19x19, where the root is four times wider than on 9x9. Its
  // widths are the untuned default until a 19x19 bench can actually measure them.
  [IPVGO_HIDDEN_OPPONENT]: { beam: 12, whiteChildren: 6, whiteMass: 0.9 },
}

/** The hidden faction was never tuned; it plays the Netburners widths. */
const IPVGO_DEFAULT_WIDTH = { beam: 12, whiteChildren: 6, whiteMass: 0.9 }

/**
 * Per-move node budget for this run, from the command line. Undefined means "use the stored
 * per-faction Sims". Never written back: an experiment must not overwrite the tuned settings.
 */
let nodeLimitOverride: number | undefined

function parseOpponent(value: string | number | undefined): GoOpponent {
  // The node limit can be the first argument, so anything that is not a faction name is left
  // to the defaults (and to auto-setup) instead of being an error.
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_OPPONENT
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

/**
 * `run ipvgo.js <nodes>`: the only parameter the script needs. A number anywhere in the
 * arguments sets the per-move node budget for this run, overriding the stored one.
 */
function parseNodeLimit(args: ReadonlyArray<string | number | boolean>): number | undefined {
  for (const arg of args) {
    const value = typeof arg === "number" ? arg : typeof arg === "string" ? Number(arg.trim()) : NaN
    if (!Number.isFinite(value) || value < 100) continue
    return Math.floor(value)
  }
  return undefined
}

function buildAutoSetup(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  config: IpvgoFactionConfig,
) {
  const nodePowerByFaction = estimateNodePowerByFaction(ns, snapshot.opponentStats)
  // The auto rotation plays the smallest board: a 5x5 game is a fraction of the moves and
  // searches of a 13x13 one, and 5x5 against the Illuminati pays eight times the node power
  // of any other board, so the target is chosen for that board.
  const smallestBoardSize = Math.min(...IPVGO_BOARD_SIZES) as IpvgoBoardSize
  const opponent = pickHighestGainFaction(
    nodePowerByFaction,
    snapshot.opponentStats,
    config,
    smallestBoardSize,
  )
  return {
    opponent,
    boardSize: smallestBoardSize,
    iterations: nodeLimitOverride ?? getFactionSims(config, opponent),
  }
}

function withFactionConfig(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  config: IpvgoFactionConfig
) {
  const enriched = enrichSnapshotWithFactionConfig(ns, refreshFactionStats(snapshot, ns), config)
  if (nodeLimitOverride == null) return enriched
  // The run-wide node budget replaces the stored per-faction Sims for this run only; showing it
  // in the Sims column keeps the tail UI honest about what is actually being spent.
  const factionSims: Partial<Record<GoOpponent, number>> = { ...enriched.factionSims }
  for (const faction of IPVGO_OPPONENTS) factionSims[faction] = nodeLimitOverride
  return { ...enriched, iterations: nodeLimitOverride, factionSims }
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
  // A pass the engine chose is deliberate - it ends the game when the opponent has passed
  // and no move raises the score - so it is never replaced by a legal move.
  if (preferred?.type === "pass") return preferred
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

/**
 * Consecutive passes so far, which the engine needs: two passes end the game, and a game whose
 * score cannot improve ends on one when the opponent has passed. The game reports a pass as
 * `previousMove === null` (also null before the first move, hence the history check).
 */
function currentPassCount(ns: NS): number {
  return ns.go.getGameState().previousMove === null && ns.go.getMoveHistory().length > 0 ? 1 : 0
}

/**
 * The engine request for one move. Everything the bench Run pane tunes travels with it, so
 * the search the game plays is the search the bench measured; `snapshot.iterations` is the
 * per-faction node budget (the Sims column in the tail UI).
 */
function buildEngineRequest(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  board: IpvgoBoard,
  history: IpvgoBoard[],
  validMoves: IpvgoValidMoves,
  komi: number,
  cheatsAvailable: boolean
): IpvgoMoveRequest {
  const width = IPVGO_FACTION_SEARCH[snapshot.opponent] ?? IPVGO_DEFAULT_WIDTH
  const cheat = cheatsAvailable ? readCheatContext(ns) : null
  return {
    board,
    history,
    komi,
    playAs: "X",
    validMoves,
    opponent: snapshot.opponent,
    iterations: snapshot.iterations,
    passCount: currentPassCount(ns),
    beam: width.beam,
    whiteChildren: width.whiteChildren,
    whiteMass: width.whiteMass,
    endgameEmpties: IPVGO_SEARCH.endgameEmpties,
    nodeBudget: IPVGO_SEARCH.endgameNodeBudget,
    maxDepth: IPVGO_SEARCH.maxDepth,
    threads: IPVGO_SEARCH.threads,
    carry: IPVGO_SEARCH.carry,
    verifyRootReplies: IPVGO_SEARCH.verifyRootReplies,
    cheats: cheat !== null,
    cheatCount: cheat?.count ?? 0,
    crimeSuccessMult: cheat?.crimeSuccessMult ?? 1,
    sourceFile14Level: cheat?.sourceFile14Level ?? 0,
    cheatMargin: IPVGO_SEARCH.cheatMargin,
    cheatMaxAttempts: IPVGO_SEARCH.cheatMaxAttempts,
    cheatLosingGate: IPVGO_SEARCH.cheatLosingGate,
  }
}

function formatOpponentTurn(result: { type: string; x: number | null; y: number | null }): string {
  if (result.type === "pass") return "pass"
  if (result.type === "move" && result.x !== null && result.y !== null) {
    return formatIpvgoPoint(result.x, result.y)
  }
  return result.type
}

/**
 * The position White moved in. A stone pushes the board it was played on onto the move history
 * (newest first); a pass leaves the board untouched, so the current board is that position.
 */
function boardWhiteMovedIn(ns: NS, move: IpvgoMove): IpvgoBoard {
  if (move.type === "pass") return ns.go.getBoardState()
  return ns.go.getMoveHistory()[0] ?? ns.go.getBoardState()
}

/** Written on a parity failure so the position can be replayed and compared with the game. */
const PARITY_DUMP_FILE = "ipvgo-parity-error.json"

/**
 * Parity check: was White's actual reply one of the moves the engine's model contains? The
 * engine's numbers only mean anything for replies it modelled, so a reply it never considered
 * means the ported White policy and the game have diverged - worth stopping for rather than
 * playing on with values that do not describe the game.
 */
async function checkWhiteReplyParity(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  whiteMove: IpvgoMove
): Promise<string | null> {
  if (!IPVGO_SEARCH.parityCheck) return null
  const width = IPVGO_FACTION_SEARCH[snapshot.opponent] ?? IPVGO_DEFAULT_WIDTH
  const board = boardWhiteMovedIn(ns, whiteMove)
  const komi = ns.go.getGameState().komi || IPVGO_KOMI_BY_OPPONENT[snapshot.opponent] || 5.5
  const request: IpvgoMoveRequest = {
    board,
    // The model's legality depends on the boards played before this one (superko), so the
    // check has to see the same history the game does - without it the model happily returns
    // a stone where the game, correctly, has no legal move left and passes.
    history: ns.go.getMoveHistory(),
    komi,
    playAs: "O",
    validMoves: [],
    opponent: snapshot.opponent,
    // A pass by us leaves the count at one, and that is what gates White's move options.
    passCount: currentPassCount(ns),
    whiteChildren: width.whiteChildren,
    whiteMass: width.whiteMass,
    verifyRootReplies: IPVGO_SEARCH.verifyRootReplies,
    whiteReplyCheck:
      whiteMove.type === "pass" ? { pass: true } : { x: whiteMove.x, y: whiteMove.y },
  }

  let report
  try {
    report = await checkIpvgoWhiteReply(request)
  } catch {
    return null
  }
  if (!report || report.modelled) return null

  // The position is the only way to tell a model gap from a broken request, so it is written
  // out (the file downloads to data/ through viteburner) and printed with the error.
  try {
    ns.write(
      PARITY_DUMP_FILE,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          opponent: snapshot.opponent,
          boardSize: snapshot.boardSize,
          komi,
          moveNumber: snapshot.moveNumber,
          whiteMove: whiteMove.type === "pass" ? { pass: true } : { x: whiteMove.x, y: whiteMove.y },
          report,
          board,
        },
        null,
        2
      ),
      "w"
    )
  } catch {
    /* home may not accept the write */
  }

  const where = whiteMove.type === "pass" ? "pass" : formatIpvgoPoint(whiteMove.x, whiteMove.y)
  const message =
    `White played ${where}, which the reply model does not contain ` +
    `(${report.modelledCount} replies modelled, ${report.keptCount} searched, ` +
    `${Math.round(report.coveredMass * 100)}% of the mass)`
  ns.print(`${message} - position written to ${PARITY_DUMP_FILE}`)
  for (const row of board) ns.print(`  ${row}`)
  return message
}

/**
 * Stops the run on a parity failure: the engine's White model no longer describes the game, so
 * every value it returns is suspect. Printed to the tail log and to the terminal, with a toast,
 * so it cannot be missed while the script is in the background.
 */
async function stopOnParityError(
  ns: NS,
  snapshot: ReturnType<typeof createIpvgoSnapshot>,
  tailLog: ReturnType<typeof createTailLog>,
  adaptiveLog: ReturnType<typeof createAdaptiveTailLog>,
  message: string
): Promise<void> {
  const line = `PARITY ERROR: ${message}`
  ns.print(line)
  ns.tprint(line)
  try {
    ns.toast("IPvGO stopped: unmodelled White reply", "error", 20000)
  } catch {
    /* toast is not available everywhere */
  }
  const next = { ...syncGameState(ns, snapshot), phase: "Parity error", thinking: false }
  await renderIpvgoDashboard(ns, tailLog, next, adaptiveLog)
}

type InProgressGame = {  opponent: GoOpponent
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
  return {
    ...refreshFactionStats(snapshot, ns),
    currentPlayer: ns.go.getCurrentPlayer(),
    komi: gameState.komi || IPVGO_KOMI_BY_OPPONENT[snapshot.opponent] || 5.5,
    blackScore: gameState.blackScore,
    whiteScore: gameState.whiteScore,
    board: ns.go.getBoardState(),
  }
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

  // One runtime parameter: a number anywhere in the arguments is this run's node budget.
  nodeLimitOverride = parseNodeLimit(ns.args)

  const opponent = parseOpponent(ns.args[0] as string | number | undefined)
  const boardSize = parseBoardSize(ns.args[1] as string | number | undefined)

  let factionConfig = loadFactionConfig(ns)

  const inProgress = detectInProgressGame(ns)
  let activeOpponent = inProgress?.opponent ?? opponent
  let activeBoardSize = inProgress?.boardSize ?? boardSize

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
    )
    activeOpponent = autoSetup.opponent
    activeBoardSize = autoSetup.boardSize as IpvgoBoardSize
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
    snapshot = { ...snapshot, phase: "Error: exploiter engine unavailable" }
    await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
    return
  }

  snapshot = { ...snapshot, phase: "Ready" }
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
        pendingGameResult = null

        const deferred = takeDeferredSetup()
        if (deferred) {
          const setupApplied = applyIpvgoSetupChange(ns, snapshot, deferred, { forceReset: true })
          snapshot = withFactionConfig(ns, setupApplied.snapshot, factionConfig)
          activeOpponent = snapshot.opponent
          activeBoardSize = snapshot.boardSize as IpvgoBoardSize
          } else {
          snapshot = withFactionConfig(ns, refreshFactionStats(snapshot, ns), factionConfig)
          const autoSetup = buildAutoSetup(ns, snapshot, factionConfig)
          const setupApplied = applyIpvgoSetupChange(ns, snapshot, autoSetup, { forceReset: true })
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
        const parity = await checkWhiteReplyParity(
          ns,
          snapshot,
          waitResult.type === "pass"
            ? { type: "pass" }
            : { type: "move", x: waitResult.x ?? -1, y: waitResult.y ?? -1 }
        )
        if (parity) {
          await stopOnParityError(ns, snapshot, tailLog, adaptiveLog, parity)
          return
        }
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

      // The engine decides: it values every legal point, the pass and the cheats in the same
      // search, so a cheat is only proposed when it beats playing on - and the attempt budget
      // and the "only while losing" gate are applied inside that search.
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

      // The cheat API needs Source-File 14.2, so the engine is only told to value cheats when
      // the game will actually let us play one.
      const cheatStats = readCheatStats(ns)
      const cheatsAvailable = IPVGO_SEARCH.cheats && cheatStats.available
      const request = buildEngineRequest(
        ns,
        snapshot,
        board,
        history,
        validMoves,
        komi,
        cheatsAvailable
      )
      const started = performance.now()
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
      const thinkMs = performance.now() - started
      const sims = analysis.nodes ?? analysis.iterations ?? 0

      if (analysis.cheatPreferred && analysis.cheat) {
        const proposal = analysis.cheat
        snapshot = {
          ...syncGameState(ns, snapshot),
          moveNumber,
          legalCount,
          validMoves,
          phase: `Cheat ${CHEAT_KIND_NAMES[proposal.kind] ?? proposal.kind}`,
          thinking: false,
        }
        await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)

        ns.go.analysis.highlightPoint(proposal.x1, proposal.y1, "hack", "cheat")
        if (proposal.kind === 2) {
          ns.go.analysis.highlightPoint(proposal.x2, proposal.y2, "hack", "cheat")
        }
        const cheatStarted = performance.now()
        const play = await playEngineCheat(ns, proposal, board)
        ns.go.analysis.clearAllPointHighlights()

        // An unavailable target means the board moved under the proposal; fall through and
        // play the engine's ordinary move instead.
        if (play.outcome !== "invalid") {
          const cheatMs = performance.now() - cheatStarted
          const chance = ` (${Math.round(cheatStats.successChance * 100)}%)`
          snapshot = recordOurCheat(snapshot, moveNumber, `${play.label}${chance}`, {
            elapsedMs: cheatMs,
            sims,
            value: analysis.value,
            depth: analysis.depth,
          })

          const cheatResult = play.result
          const cheatParityMove: IpvgoMove | null = cheatResult
            ? cheatResult.type === "move" && cheatResult.x !== null && cheatResult.y !== null
              ? { type: "move", x: cheatResult.x, y: cheatResult.y }
              : { type: "pass" }
            : null
          const cheatParity = cheatParityMove
            ? await checkWhiteReplyParity(ns, snapshot, cheatParityMove)
            : null
          if (cheatParity) {
            await stopOnParityError(ns, snapshot, tailLog, adaptiveLog, cheatParity)
            return
          }

          if (!cheatResult || cheatResult.type === "gameOver") {
            // An ejection ends the game as a loss whatever the board says.
            snapshot = logGameEnd(
              ns,
              snapshot,
              activeOpponent,
              (won) => {
                pendingGameResult = won
              },
              play.outcome === "ejected" ? false : undefined
            )
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

          const ourMove: IpvgoMove = { type: "move", x: proposal.x1, y: proposal.y1 }
          snapshot = {
            ...syncGameState(ns, snapshot),
            moveNumber,
            legalCount,
            validMoves: undefined,
            lastOurMove: ourMove,
            lastOpponentMove: opponentReply || snapshot.lastOpponentMove,
            thinkMs,
            sims,
            thinking: false,
            phase: play.outcome === "succeeded" ? "Cheat succeeded" : "Cheat failed",
          }
          await renderIpvgoDashboard(ns, tailLog, snapshot, adaptiveLog)
          await sleepUntilIpvgoSetupChange(ns, LOOP_SLEEP_MS)
          continue
        }
      }

      const move = pickLegalMove(validMoves, analysis.move)
      snapshot = recordOurMove(snapshot, moveNumber, move, {
        thinkMs,
        sims,
        value: analysis.value,
        depth: analysis.depth,
      })

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
        // The game takes a while to answer; let the engine use that time.
        ponderIpvgoEngine(request, move)
        ns.go.analysis.highlightPoint(move.x, move.y, "hack", "MCTS")
        result = await ns.go.makeMove(move.x, move.y)
        ns.go.analysis.clearAllPointHighlights()
      }

      const oppMs = performance.now() - oppStarted

      // White's reply is checked against the model even when it ends the game: the parity
      // question is about the model, not about the result.
      const whitePlayed: IpvgoMove =
        result.type === "move" && result.x !== null && result.y !== null
          ? { type: "move", x: result.x, y: result.y }
          : { type: "pass" }
      const opponentParity = await checkWhiteReplyParity(ns, snapshot, whitePlayed)
      if (opponentParity) {
        await stopOnParityError(ns, snapshot, tailLog, adaptiveLog, opponentParity)
        return
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
  onResult?: (won: boolean) => void,
  forcedWin?: boolean
) {
  const gameState = ns.go.getGameState()
  // The game awards a tie to Black, so a level score is a win.
  const won = forcedWin ?? gameState.blackScore >= gameState.whiteScore
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
