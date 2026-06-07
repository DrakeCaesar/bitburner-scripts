import { NS } from "@ns"
import {
  getInfiltrationSolverPollMs,
  setupInfiltrationSolver,
  shutdownInfiltrationSolver,
  tickInfiltrationSolver,
} from "./libraries/infiltration/infiltrationSolver.js"

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")

  const solver = setupInfiltrationSolver(ns)

  while (true) {
    try {
      const result = tickInfiltrationSolver(ns, solver)
      if (result === "cancelled") {
        shutdownInfiltrationSolver(solver)
        return
      }
    } catch (err) {
      ns.print("ERROR: Infiltration solver skipped: " + String(err))
    }

    await ns.sleep(getInfiltrationSolverPollMs(solver))
  }
}
