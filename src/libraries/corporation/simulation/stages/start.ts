import type { DivisionSnapshot, SimContext } from "../types.js"

/** START: roll last-cycle stats and decay popularity (per division). */
export function simulateStartStage(division: DivisionSnapshot, ctx: SimContext): void {
  const elapsed = ctx.secondsPerMarketCycle * ctx.marketCycles
  if (elapsed > 0) {
    division.lastCycleRevenue = division.thisCycleRevenue / elapsed
    division.lastCycleExpenses = division.thisCycleExpenses / elapsed
  }
  division.thisCycleRevenue = 0
  division.thisCycleExpenses = 0
  division.popularity = Math.max(0, division.popularity - ctx.marketCycles * 0.0001)
}
