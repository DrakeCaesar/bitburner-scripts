import { CrimeStats, CrimeType, NS } from "@ns"

interface CrimeInfo {
  name: CrimeType
  chance: number
  stats: CrimeStats
  profitPerMs: number
  expectedProfitPerMs: number
  karmaPerMs: number
  expectedKarmaPerMs: number
  totalXpPerMs: number
}

function getBestCrime(ns: NS, mode: "money" | "karma" | "xp"): CrimeInfo {
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

    // Calculate total XP per millisecond (all stat gains combined, no chance dependency)
    const totalXpPerMs = (stats.hacking_exp + stats.strength_exp + stats.defense_exp + 
                         stats.dexterity_exp + stats.agility_exp + stats.charisma_exp) / stats.time

    return {
      name: crime,
      chance,
      stats,
      profitPerMs,
      expectedProfitPerMs,
      karmaPerMs,
      expectedKarmaPerMs,
      totalXpPerMs,
    }
  })

  if (mode === "karma") {
    // Sort by expected karma loss per millisecond (descending)
    crimeInfos.sort((a, b) => b.expectedKarmaPerMs - a.expectedKarmaPerMs)
  } else if (mode === "xp") {
    // Sort by total XP per millisecond (descending, no chance dependency)
    crimeInfos.sort((a, b) => b.totalXpPerMs - a.totalXpPerMs)
  } else {
    // Sort by expected profit per millisecond (descending)
    crimeInfos.sort((a, b) => b.expectedProfitPerMs - a.expectedProfitPerMs)
  }

  return crimeInfos[0]
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")

  // Determine mode based on command line argument
  let mode: "money" | "karma" | "xp" = "xp" // default
  
  if (ns.args[0] === "karma" || ns.args[0] === "k") {
    mode = "karma"
  } else if (ns.args[0] === "xp" || ns.args[0] === "x") {
    mode = "xp"
  }

  if (mode === "karma") {
    ns.print("Running in KARMA mode - prioritizing karma loss rate")
  } else if (mode === "xp") {
    ns.print("Running in XP mode - prioritizing total experience gain rate")
  } else {
    ns.print("Running in MONEY mode - prioritizing profit rate")
  }

  for (;;) {
    await ns.sleep(10)
    // Get the best crime based on selected mode
    const bestCrime = getBestCrime(ns, mode)

    ns.print(`Best crime: ${bestCrime.name}`)
    ns.print(`  Chance: ${(bestCrime.chance * 100).toFixed(2)}%`)
    ns.print(`  Money: $${ns.formatNumber(bestCrime.stats.money)}`)
    ns.print(`  Time: ${ns.tFormat(bestCrime.stats.time)}`)
    ns.print(`  Profit/s: $${ns.formatNumber(bestCrime.profitPerMs * 1000)}/s`)
    ns.print(`  Expected profit/s: $${ns.formatNumber(bestCrime.expectedProfitPerMs * 1000)}/s`)

    if (mode === "karma") {
      ns.print(`  Karma: ${bestCrime.stats.karma.toFixed(2)}`)
      ns.print(`  Karma/s: ${(bestCrime.karmaPerMs * 1000).toFixed(2)}/s`)
      ns.print(`  Expected karma/s: ${(bestCrime.expectedKarmaPerMs * 1000).toFixed(2)}/s`)
    } else if (mode === "xp") {
      ns.print(`  Total XP/s: ${ns.formatNumber(bestCrime.totalXpPerMs * 1000)}/s`)
      ns.print(`  Hacking XP: ${ns.formatNumber(bestCrime.stats.hacking_exp)}`)
      ns.print(`  Combat XP: ${ns.formatNumber(bestCrime.stats.strength_exp + bestCrime.stats.defense_exp + bestCrime.stats.dexterity_exp + bestCrime.stats.agility_exp)}`)
      ns.print(`  Charisma XP: ${ns.formatNumber(bestCrime.stats.charisma_exp)}`)
    }

    // Commit the crime
    const crimeTime = ns.singularity.commitCrime(bestCrime.name, false)

    // Wait for the crime to complete
    await ns.sleep(crimeTime + 10)
  }
}
