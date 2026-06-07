import { NS } from "@ns"
import {
  canSolveInfiltrationTask,
  createInfiltrationDomWindow,
  getMinigamePhaseKey,
  readInfiltrationDomState,
  updateInfiltrationDomView,
} from "./libraries/infiltrationDom.js"
import {
  pressInfiltrationKey,
  enableTrustedKeyInjection,
  disableTrustedKeyInjection,
  clearInfiltrationKeyHandler,
  isInfiltrationKeyInputReady,
  getInfiltrationKeyInputMode,
  describeInfiltrationKeyInput,
} from "./libraries/infiltrationKeyInput.js"
import {
  formatSentKeySequence,
  formatSolverPreview,
  solveInfiltrationTask,
} from "./libraries/infiltrationSolvers.js"
import { isWireCuttingTask } from "./libraries/infiltrationWireCutting.js"

const KEY_DELAY_MS = 50
const BRACKET_KEY_DELAY_MS = 100
const POLL_MS = 100

function getKeyDelayMs(taskTitle: string): number {
  if (taskTitle.includes("Close the bracket")) return BRACKET_KEY_DELAY_MS
  if (isWireCuttingTask(taskTitle)) return 80
  return KEY_DELAY_MS
}

interface SolveSession {
  phaseKey: string
  taskTitle: string
  pendingKeys: string[]
  sentKeys: string[]
  nextKeyIndex: number
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

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")

  enableTrustedKeyInjection()
  ns.atExit(() => disableTrustedKeyInjection())

  const scriptName = ns.getScriptName()
  for (const proc of ns.ps(ns.getHostname())) {
    if (proc.filename === scriptName && proc.pid !== ns.pid) {
      ns.kill(proc.pid)
    }
  }

  const existingWindow = document.querySelector("#infiltration-dom-window") as HTMLElement | null

  const getPosition = (element: HTMLElement | null): { x: number; y: number } | null => {
    if (!element) return null
    const style = window.getComputedStyle(element)
    const matrix = new DOMMatrix(style.transform)
    return { x: matrix.m41 || 0, y: matrix.m42 || 0 }
  }

  const getCollapsedState = (element: HTMLElement | null): boolean => {
    if (!element) return false
    const contentArea = element.querySelector('[class*="MuiCollapse-root"]')
    if (!contentArea) return false
    return !contentArea.classList.contains("MuiCollapse-entered")
  }

  const position = getPosition(existingWindow)
  const isCollapsed = getCollapsedState(existingWindow)
  existingWindow?.remove()

  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement | null
  let primaryColor = "#0f0"
  if (primaryElement) {
    primaryColor = window.getComputedStyle(primaryElement).color || primaryColor
  }

  const infiltrationWindow = createInfiltrationDomWindow(primaryColor, position ?? undefined, isCollapsed)

  let session: SolveSession | null = null
  let wasActive = false

  while (true) {
    try {
      const state = readInfiltrationDomState()
      const phaseKey = getMinigamePhaseKey(state)
      const canSolve = canSolveInfiltrationTask(state)

      if (wasActive && !state.active) {
        clearInfiltrationKeyHandler()
        session = null
      }
      wasActive = state.active

      if (!phaseKey) {
        session = null
      } else if (!session || session.phaseKey !== phaseKey) {
        if (canSolve) {
          const solved = solveInfiltrationTask(state.taskTitle, state)
          if (solved?.length) {
            session = {
              phaseKey,
              taskTitle: state.taskTitle,
              pendingKeys: solved,
              sentKeys: [],
              nextKeyIndex: 0,
            }
          } else {
            session = null
          }
        } else {
          session = null
        }
      }

      const viewExtras = buildViewExtras(state, phaseKey, session, canSolve)
      updateInfiltrationDomView(infiltrationWindow.container, viewExtras)

      if (session && phaseKey && session.nextKeyIndex < session.pendingKeys.length) {
        if (!isInfiltrationKeyInputReady()) {
          await ns.sleep(POLL_MS)
          continue
        }

        const key = session.pendingKeys[session.nextKeyIndex]
        if (pressInfiltrationKey(key)) {
          session.sentKeys.push(key)
          session.nextKeyIndex++
        }

        updateInfiltrationDomView(
          infiltrationWindow.container,
          buildViewExtras(state, phaseKey, session, canSolve)
        )
        await ns.sleep(getKeyDelayMs(session.taskTitle))
        continue
      }
    } catch (err) {
      ns.print("ERROR: Infiltration solver skipped: " + String(err))
    }

    await ns.sleep(POLL_MS)
  }
}
