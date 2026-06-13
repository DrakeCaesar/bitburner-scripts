import type { NS } from "@ns"
import type { GoOpponent } from "@ns"
import type { IpvgoBoardSize } from "./types.js"

const SETUP_POLL_MS = 100

export type IpvgoSetupSelection = {
  opponent: GoOpponent
  boardSize: IpvgoBoardSize
  iterations: number
}

let pendingSetup: IpvgoSetupSelection | null = null

export function markIpvgoSetupPending(
  opponent: GoOpponent,
  boardSize: IpvgoBoardSize,
  iterations: number
): void {
  pendingSetup = { opponent, boardSize, iterations }
}

export function hasIpvgoSetupPending(): boolean {
  return pendingSetup != null
}

export function consumeIpvgoSetupPending(): IpvgoSetupSelection | null {
  const next = pendingSetup
  pendingSetup = null
  return next
}

/** Wake early when the user changes setup in the tail UI. */
export async function sleepUntilIpvgoSetupChange(ns: NS, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (hasIpvgoSetupPending()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await ns.sleep(Math.min(SETUP_POLL_MS, remaining))
  }
  return hasIpvgoSetupPending()
}
