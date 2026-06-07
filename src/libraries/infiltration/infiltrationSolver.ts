import type { NS } from "@ns"
import {
  canSolveInfiltrationTask,
  createInfiltrationDomWindow,
  getMinigamePhaseKey,
  readInfiltrationDomState,
  updateInfiltrationDomView,
  type InfiltrationDomWindow,
} from "./infiltrationDom.js"
import { clearRememberedMines } from "./infiltrationMinesweeper.js"
import {
  pressInfiltrationKey,
  enableTrustedKeyInjection,
  disableTrustedKeyInjection,
  clearInfiltrationKeyHandler,
  isInfiltrationKeyInputReady,
  getInfiltrationKeyInputMode,
  describeInfiltrationKeyInput,
  INFILTRATION_KEY_DELAY_MS,
} from "./infiltrationKeyInput.js"
import {
  formatSentKeySequence,
  formatSolverPreview,
  solveInfiltrationTask,
} from "./infiltrationSolvers.js"
import {
  clearInfiltrationRunOutcome,
  peekInfiltrationRunOutcome,
  setInfiltrationRunOutcome,
} from "./infiltrationRunState.js"
import {
  collectInfiltrationVictoryReward,
  isInfiltrationVictoryScreen,
} from "./infiltrationVictory.js"

export type InfiltrationSolverTickResult = "continue" | "cancelled" | "victory"

interface SolveSession {
  phaseKey: string
  taskTitle: string
  pendingKeys: string[]
  sentKeys: string[]
  nextKeyIndex: number
}

export interface InfiltrationSolverState {
  window: InfiltrationDomWindow
  session: SolveSession | null
  wasActive: boolean
  victoryHandled: boolean
}

function describeSendState(
  phaseKey: string,
  session: SolveSession | null,
  canSolve: boolean,
  handlerMode: string
): string {
  if (!phaseKey) return "waiting for task"
  if (!canSolve) return "waiting for assignment"
  if (!session) return "waiting for solve"
  if (session.nextKeyIndex >= session.pendingKeys.length) return "done"
  const nextKey = formatSentKeySequence(session.taskTitle, [session.pendingKeys[session.nextKeyIndex]])
  if (handlerMode === "missing") {
    return `waiting for handler (${describeInfiltrationKeyInput()})`
  }
  return `next ${nextKey} (${handlerMode})`
}

function buildViewExtras(
  state: ReturnType<typeof readInfiltrationDomState>,
  phaseKey: string,
  session: SolveSession | null,
  canSolve: boolean
) {
  const handlerReady = isInfiltrationKeyInputReady()
  const handlerMode = getInfiltrationKeyInputMode()
  const pendingKeys = session?.pendingKeys ?? []
  const sentKeys = session?.sentKeys ?? []

  return {
    solverPreview: phaseKey
      ? formatSolverPreview(state.taskTitle, session?.pendingKeys ?? null)
      : undefined,
    sendStatus: phaseKey
      ? {
          sentKeys,
          totalKeys: pendingKeys.length,
          handlerReady,
          handlerMode,
          handlerDetail: handlerReady ? undefined : describeInfiltrationKeyInput(),
          sendState: describeSendState(phaseKey, session, canSolve, handlerMode),
        }
      : undefined,
    formatSentKeys: (keys: string[]) => formatSentKeySequence(state.taskTitle, keys),
  }
}

function getWindowPosition(element: HTMLElement | null): { x: number; y: number } | null {
  if (!element) return null
  const style = window.getComputedStyle(element)
  const matrix = new DOMMatrix(style.transform)
  return { x: matrix.m41 || 0, y: matrix.m42 || 0 }
}

function getWindowCollapsedState(element: HTMLElement | null): boolean {
  if (!element) return false
  const contentArea = element.querySelector('[class*="MuiCollapse-root"]')
  if (!contentArea) return false
  return !contentArea.classList.contains("MuiCollapse-entered")
}

export function setupInfiltrationSolver(ns: NS): InfiltrationSolverState {
  enableTrustedKeyInjection()
  ns.atExit(() => disableTrustedKeyInjection())

  const scriptName = ns.getScriptName()
  for (const proc of ns.ps(ns.getHostname())) {
    if (proc.filename === scriptName && proc.pid !== ns.pid) {
      ns.kill(proc.pid)
    }
  }

  const existingWindow = document.querySelector("#infiltration-dom-window") as HTMLElement | null
  const position = getWindowPosition(existingWindow)
  const isCollapsed = getWindowCollapsedState(existingWindow)
  existingWindow?.remove()

  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement | null
  let primaryColor = "#0f0"
  if (primaryElement) {
    primaryColor = window.getComputedStyle(primaryElement).color || primaryColor
  }

  return {
    window: createInfiltrationDomWindow(primaryColor, position ?? undefined, isCollapsed),
    session: null,
    wasActive: false,
    victoryHandled: false,
  }
}

export function shutdownInfiltrationSolver(state: InfiltrationSolverState): void {
  clearInfiltrationKeyHandler()
  clearRememberedMines()
  state.window.window.close()
  disableTrustedKeyInjection()
}

export function tickInfiltrationSolver(
  ns: NS,
  state: InfiltrationSolverState
): InfiltrationSolverTickResult {
  if (isInfiltrationVictoryScreen()) {
    if (!state.victoryHandled) {
      const reward = collectInfiltrationVictoryReward(ns)
      if (reward.ok) {
        state.victoryHandled = true
        setInfiltrationRunOutcome("victory")
        ns.print(`Victory reward: ${reward.detail}`)
        return "victory"
      }
    }
    return "continue"
  }
  state.victoryHandled = false

  const domState = readInfiltrationDomState()
  const phaseKey = getMinigamePhaseKey(domState)
  const canSolve = canSolveInfiltrationTask(domState)

  if (state.wasActive && !domState.active) {
    clearInfiltrationKeyHandler()
    clearRememberedMines()
    state.session = null

    if (!isInfiltrationVictoryScreen() && peekInfiltrationRunOutcome() !== "victory") {
      setInfiltrationRunOutcome("cancelled")
      ns.print("Infiltration cancelled. Stopping script.")
      return "cancelled"
    }

    clearInfiltrationRunOutcome()
  }
  state.wasActive = domState.active

  if (!phaseKey) {
    state.session = null
  } else if (!state.session || state.session.phaseKey !== phaseKey) {
    if (canSolve) {
      const solved = solveInfiltrationTask(domState.taskTitle, domState)
      if (solved?.length) {
        state.session = {
          phaseKey,
          taskTitle: domState.taskTitle,
          pendingKeys: solved,
          sentKeys: [],
          nextKeyIndex: 0,
        }
      } else {
        state.session = null
      }
    } else {
      state.session = null
    }
  }

  const viewExtras = buildViewExtras(domState, phaseKey, state.session, canSolve)
  updateInfiltrationDomView(state.window.container, viewExtras)

  if (state.session && phaseKey && state.session.nextKeyIndex < state.session.pendingKeys.length) {
    if (!isInfiltrationKeyInputReady()) {
      return "continue"
    }

    const key = state.session.pendingKeys[state.session.nextKeyIndex]
    if (pressInfiltrationKey(key)) {
      state.session.sentKeys.push(key)
      state.session.nextKeyIndex++
    }

    updateInfiltrationDomView(
      state.window.container,
      buildViewExtras(domState, phaseKey, state.session, canSolve)
    )
  }

  return "continue"
}

export function getInfiltrationSolverPollMs(state: InfiltrationSolverState): number {
  if (!state.session) return 100
  if (state.session.nextKeyIndex >= state.session.pendingKeys.length) return 100
  return INFILTRATION_KEY_DELAY_MS
}
