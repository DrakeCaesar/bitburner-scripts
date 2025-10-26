import { CrimeStats, CrimeType, NS } from "@ns"

interface CrimeInfo {
  name: CrimeType
  chance: number
  stats: CrimeStats
  profitPerMs: number
  expectedProfitPerMs: number
}

function getBestCrime(ns: NS): CrimeInfo {
  const crimes = Object.values(ns.enums.CrimeType)

  const crimeInfos: CrimeInfo[] = crimes.map((crime) => {
    const stats = ns.singularity.getCrimeStats(crime)
    const chance = ns.singularity.getCrimeChance(crime)

    // Calculate profit per millisecond
    const profitPerMs = stats.money / stats.time

    // Expected profit accounts for success chance
    const expectedProfitPerMs = profitPerMs * chance

    return {
      name: crime,
      chance,
      stats,
      profitPerMs,
      expectedProfitPerMs,
    }
  })

  // Sort by expected profit per millisecond (descending)
  crimeInfos.sort((a, b) => b.expectedProfitPerMs - a.expectedProfitPerMs)

  return crimeInfos[0]
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")

  for (;;) {
    await ns.sleep(100)
    // Get the best crime based on expected profit per millisecond
    const bestCrime = getBestCrime(ns)

    ns.print(`Best crime: ${bestCrime.name}`)
    ns.print(`  Chance: ${(bestCrime.chance * 100).toFixed(2)}%`)
    ns.print(`  Money: $${ns.formatNumber(bestCrime.stats.money)}`)
    ns.print(`  Time: ${ns.tFormat(bestCrime.stats.time)}`)
    ns.print(`  Profit/s: $${ns.formatNumber(bestCrime.profitPerMs * 1000)}/s`)
    ns.print(`  Expected profit/s: $${ns.formatNumber(bestCrime.expectedProfitPerMs * 1000)}/s`)

    // Commit the crime
    const crimeTime = ns.singularity.commitCrime(bestCrime.name)

    // Wait for the crime to complete
    await ns.sleep(crimeTime + 200)
  }
}
