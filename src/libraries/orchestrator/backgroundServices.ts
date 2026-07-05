import { FactionName, NS } from "@ns"
import { autoNuke } from "../../autoNuke.js"
import { joinWorthyFactionInvitations } from "../factionInvites.js"
import { purchasePrograms, purchaseTorRouter } from "../purchasePrograms.js"
import { purchaseServers } from "../purchaseServer.js"

/**
 * Scaffolding for orchestrator-managed background work.
 *
 * Nothing calls these yet — orchestrator is goal-tree only until we decide
 * when/how each task runs (every tick, on goal activation, as child scripts, etc.).
 */

export const BATCH_SCRIPT = "batch.js"
export const CONTRACT_SOLVER_SCRIPT = "contractSolver.js"

// --- Singularity setup (formerly at the top of each batch cycle) ---

export function joinPendingFactionInvitations(ns: NS): FactionName[] {
  return joinWorthyFactionInvitations(ns)
}

export function ensureContractSolver(ns: NS): void {
  const running = ns.ps("home").some((proc) => proc.filename === CONTRACT_SOLVER_SCRIPT)
  if (running) return

  ns.scriptKill(CONTRACT_SOLVER_SCRIPT, "home")
  ns.exec(CONTRACT_SOLVER_SCRIPT, "home", 1, "solve", "quiet")
}

export function purchaseTorIfNeeded(ns: NS, logMessage?: (message: string) => void): boolean {
  return purchaseTorRouter(ns, logMessage)
}

export function purchaseHackingPrograms(ns: NS, logMessage?: (message: string) => void): string[] {
  return purchasePrograms(ns, logMessage)
}

export async function runNetworkPrep(ns: NS, logMessage?: (message: string) => void): Promise<void> {
  await autoNuke(ns, logMessage)
}

export function purchaseWorkerServers(ns: NS): boolean {
  return purchaseServers(ns)
}

// --- Batch lifecycle (for when orchestrator owns batch.js) ---

export function isBatchRunning(ns: NS, host = "home"): boolean {
  return ns.ps(host).some((proc) => proc.filename === BATCH_SCRIPT)
}

export function ensureBatchRunning(ns: NS, host = "home"): number | null {
  if (isBatchRunning(ns, host)) return null
  return ns.exec(BATCH_SCRIPT, host, 1)
}

export function restartBatch(ns: NS, host = "home"): number {
  ns.scriptKill(BATCH_SCRIPT, host)
  return ns.exec(BATCH_SCRIPT, host, 1)
}
