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
let pendingSims: IpvgoSetupSelection | null = null
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

/** Sims preset click: apply on next loop (interrupts engine think). */
export function queueSetupSimsChange(
  opponent: GoOpponent,
  boardSize: IpvgoBoardSize,
  iterations: number
): void {
  pendingSims = { opponent, boardSize, iterations }
  if (deferredSetup) {
    deferredSetup = { ...deferredSetup, iterations }
  }
}

export function getDeferredSetup(): IpvgoSetupSelection | null {
  return deferredSetup
}

export function takeDeferredSetup(): IpvgoSetupSelection | null {
  const next = deferredSetup
  deferredSetup = null
  return next
}

export function clearDeferredSetup(): void {
  deferredSetup = null
}

export function consumeImmediateSetup(): IpvgoSetupSelection | null {
  const next = pendingImmediate
  pendingImmediate = null
  return next
}

export function consumeSimsSetup(): IpvgoSetupSelection | null {
  const next = pendingSims
  pendingSims = null
  return next
}

export function hasIpvgoSetupPending(): boolean {
  return pendingImmediate != null || pendingSims != null
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

/** @deprecated Use queueSetupSimsChange / hasIpvgoSetupPending */
export function markIpvgoSetupPending(
  opponent: GoOpponent,
  boardSize: IpvgoBoardSize,
  iterations: number
): void {
  queueSetupSimsChange(opponent, boardSize, iterations)
}

/** @deprecated Use consumeImmediateSetup / consumeSimsSetup */
export function consumeIpvgoSetupPending(): IpvgoSetupSelection | null {
  return consumeImmediateSetup() ?? consumeSimsSetup()
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
