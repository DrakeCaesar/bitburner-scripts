import { CrimeStats, CrimeType, NS } from "@ns"

interface CrimeInfo {
  name: CrimeType
  chance: number
  stats: CrimeStats
  profitPerMs: number
  expectedProfitPerMs: number
  karmaPerMs: number
  expectedKarmaPerMs: number
}

function getBestCrime(ns: NS, karmaMode: boolean): CrimeInfo {
  const crimes = Object.values(ns.enums.CrimeType)

  const crimeInfos: CrimeInfo[] = crimes.map((crime) => {
    const stats = ns.singularity.getCrimeStats(crime)
    const chance = ns.singularity.getCrimeChance(crime)

    // Calculate profit per millisecond
    const profitPerMs = stats.money / stats.time

    // Expected profit accounts for success chance
    const expectedProfitPerMs = profitPerMs * chance

    // Calculate karma loss per millisecond (karma is negative, so we use absolute value)
    const karmaPerMs = Math.abs(stats.karma) / stats.time

    // Expected karma loss accounts for success chance
    const expectedKarmaPerMs = karmaPerMs * chance

    return {
      name: crime,
      chance,
      stats,
      profitPerMs,
      expectedProfitPerMs,
      karmaPerMs,
      expectedKarmaPerMs,
    }
  })

  if (karmaMode) {
    // Sort by expected karma loss per millisecond (descending)
    crimeInfos.sort((a, b) => b.expectedKarmaPerMs - a.expectedKarmaPerMs)
  } else {
    // Sort by expected profit per millisecond (descending)
    crimeInfos.sort((a, b) => b.expectedProfitPerMs - a.expectedProfitPerMs)
  }

  return crimeInfos[0]
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")

  // Check if karma mode is enabled via command line argument
  const karmaMode = ns.args[0] === "karma" || ns.args[0] === "k"

  if (karmaMode) {
    ns.print("Running in KARMA mode - prioritizing karma loss rate")
  } else {
    ns.print("Running in MONEY mode - prioritizing profit rate")
  }

  for (;;) {
    await ns.sleep(100)
    // Get the best crime based on selected mode
    const bestCrime = getBestCrime(ns, karmaMode)

    ns.print(`Best crime: ${bestCrime.name}`)
    ns.print(`  Chance: ${(bestCrime.chance * 100).toFixed(2)}%`)
    ns.print(`  Money: $${ns.formatNumber(bestCrime.stats.money)}`)
    ns.print(`  Time: ${ns.tFormat(bestCrime.stats.time)}`)
    ns.print(`  Profit/s: $${ns.formatNumber(bestCrime.profitPerMs * 1000)}/s`)
    ns.print(`  Expected profit/s: $${ns.formatNumber(bestCrime.expectedProfitPerMs * 1000)}/s`)

    if (karmaMode) {
      ns.print(`  Karma: ${bestCrime.stats.karma.toFixed(2)}`)
      ns.print(`  Karma/s: ${(bestCrime.karmaPerMs * 1000).toFixed(2)}/s`)
      ns.print(`  Expected karma/s: ${(bestCrime.expectedKarmaPerMs * 1000).toFixed(2)}/s`)
    }

    // Commit the crime
    const crimeTime = ns.singularity.commitCrime(bestCrime.name, false)

    // Wait for the crime to complete
    await ns.sleep(crimeTime + 2000)
  }
}
