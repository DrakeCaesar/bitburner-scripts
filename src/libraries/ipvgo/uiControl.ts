import type { NS } from "@ns"
import type { GoOpponent } from "@ns"
import type { IpvgoBoardSize } from "./types.js"

const SETUP_POLL_MS = 100

export type IpvgoSetupSelection = {
  opponent: GoOpponent
  boardSize: IpvgoBoardSize
  iterations: number
}

let deferredSetup: IpvgoSetupSelection | null = null
let pendingImmediate: IpvgoSetupSelection | null = null
let pendingFactionEnabledToggle: GoOpponent | null = null
let pendingDeferUi = false

export function setupCellKey(opponent: GoOpponent, boardSize: IpvgoBoardSize): string {
  return `${opponent}:${boardSize}`
}

/**
 * Board cell click: defer switch until current game ends, unless re-clicking the
 * active playing cell or the already-queued deferred cell (abandon now).
 */
export function queueSetupBoardClick(
  opponent: GoOpponent,
  boardSize: IpvgoBoardSize,
  iterations: number,
  playingKey: string,
  deferredKey: string | null,
  clickedKey: string
): void {
  const selection = { opponent, boardSize, iterations }
  if (clickedKey === playingKey || (deferredKey != null && clickedKey === deferredKey)) {
    pendingImmediate = selection
    deferredSetup = null
    return
  }
  deferredSetup = selection
  pendingDeferUi = true
}

/** Toggle whether a faction is included in auto-rotation. */
export function queueFactionEnabledToggle(faction: GoOpponent): void {
  pendingFactionEnabledToggle = faction
  pendingDeferUi = true
}

export function consumeFactionEnabledToggle(): GoOpponent | null {
  const next = pendingFactionEnabledToggle
  pendingFactionEnabledToggle = null
  return next
}

export function getDeferredSetup(): IpvgoSetupSelection | null {
  return deferredSetup
}

export function takeDeferredSetup(): IpvgoSetupSelection | null {
  const next = deferredSetup
  deferredSetup = null
  return next
}

export function consumeImmediateSetup(): IpvgoSetupSelection | null {
  const next = pendingImmediate
  pendingImmediate = null
  return next
}

export function hasIpvgoSetupPending(): boolean {
  return (
    pendingImmediate != null ||
    pendingFactionEnabledToggle != null
  )
}

export function consumeDeferUiWake(): boolean {
  const wake = pendingDeferUi
  pendingDeferUi = false
  return wake
}

/** Wake sleep loops for defer UI sync without aborting engine think. */
export function hasIpvgoUiWake(): boolean {
  return hasIpvgoSetupPending() || pendingDeferUi
}

/** Wake early when the user changes setup in the tail UI. */
export async function sleepUntilIpvgoSetupChange(ns: NS, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (hasIpvgoUiWake()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await ns.sleep(Math.min(SETUP_POLL_MS, remaining))
  }
  return hasIpvgoUiWake()
}
