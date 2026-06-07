import { NS } from "@ns"
import {
  createInfiltrationDomWindow,
  getMinigameIdentityKey,
  readInfiltrationDomState,
  updateInfiltrationDomView,
} from "./libraries/infiltrationDom.js"
import {
  pressInfiltrationKey,
  enableTrustedKeyInjection,
  disableTrustedKeyInjection,
  clearInfiltrationKeyHandler,
} from "./libraries/infiltrationKeyInput.js"
import { formatSolverPreview, solveInfiltrationTask } from "./libraries/infiltrationSolvers.js"

const KEY_DELAY_MS = 50
const BRACKET_KEY_DELAY_MS = 100
const POLL_MS = 100

function getKeyDelayMs(taskTitle: string): number {
  if (taskTitle === "Close the brackets") return BRACKET_KEY_DELAY_MS
  return KEY_DELAY_MS
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

  let lastIdentityKey = ""
  let pendingKeys: string[] = []
  let lastSolved: string[] | null = null
  let currentTaskTitle = ""
  let nextKeyIndex = 0
  let wasActive = false

  while (true) {
    try {
      const state = readInfiltrationDomState()
      const identityKey = getMinigameIdentityKey(state)

      if (wasActive && !state.active) {
        clearInfiltrationKeyHandler()
        lastIdentityKey = ""
        pendingKeys = []
        lastSolved = null
        nextKeyIndex = 0
      }
      wasActive = state.active

      if (!identityKey && lastIdentityKey) {
        lastIdentityKey = ""
        pendingKeys = []
        lastSolved = null
        nextKeyIndex = 0
      }

      if (identityKey && identityKey !== lastIdentityKey) {
        lastIdentityKey = identityKey
        nextKeyIndex = 0
        currentTaskTitle = state.taskTitle
        lastSolved = solveInfiltrationTask(state.taskTitle, state)
        pendingKeys = lastSolved ?? []
      }

      const solverPreview = state.active ? formatSolverPreview(state.taskTitle, lastSolved) : undefined

      updateInfiltrationDomView(infiltrationWindow.container, solverPreview)

      if (!identityKey) {
        await ns.sleep(POLL_MS)
        continue
      }

      if (state.active && nextKeyIndex < pendingKeys.length) {
        pressInfiltrationKey(pendingKeys[nextKeyIndex])
        nextKeyIndex++
        await ns.sleep(getKeyDelayMs(currentTaskTitle))
        continue
      }
    } catch (err) {
      ns.print("ERROR: Infiltration solver skipped: " + String(err))
    }

    await ns.sleep(POLL_MS)
  }
}
