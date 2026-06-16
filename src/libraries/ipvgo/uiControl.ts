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
let pendingFactionSims: { faction: GoOpponent; iterations: number } | null = null
let pendingFactionEnabledToggle: GoOpponent | null = null
let simEditFaction: GoOpponent | null = null
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

/** Select which faction row receives sim preset clicks. */
export function queueSimEditFaction(faction: GoOpponent): void {
  simEditFaction = faction
  pendingDeferUi = true
}

export function getSimEditFaction(): GoOpponent | null {
  return simEditFaction
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

/** Sims preset click: overwrite stored sims for the selected faction. */
export function queueFactionSimsChange(faction: GoOpponent, iterations: number): void {
  pendingFactionSims = { faction, iterations }
  simEditFaction = faction
  if (deferredSetup && deferredSetup.opponent === faction) {
    deferredSetup = { ...deferredSetup, iterations }
  }
}

/** @deprecated Use queueFactionSimsChange */
export function queueSetupSimsChange(
  opponent: GoOpponent,
  boardSize: IpvgoBoardSize,
  iterations: number
): void {
  queueFactionSimsChange(opponent, iterations)
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

export function consumeFactionSimsChange(): { faction: GoOpponent; iterations: number } | null {
  const next = pendingFactionSims
  pendingFactionSims = null
  return next
}

/** @deprecated Use consumeFactionSimsChange */
export function consumeSimsSetup(): IpvgoSetupSelection | null {
  const sims = consumeFactionSimsChange()
  if (!sims) return null
  return { opponent: sims.faction, boardSize: 7, iterations: sims.iterations }
}

export function hasIpvgoSetupPending(): boolean {
  return (
    pendingImmediate != null ||
    pendingFactionSims != null ||
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
