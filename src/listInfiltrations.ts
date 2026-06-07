import { NS } from "@ns"
import { buildTable } from "./libraries/tableBuilder.js"

/** Matches in-game MaxDifficultyForInfiltration (Intro screen uses rating out of 100). */
const MAX_DIFFICULTY = 3.5

interface InfiltrationLocation {
  difficulty: number
  maxClearanceLevel: number
  startingSecurityLevel: number
  location: { city: string; name: string }
  reward: { sellCash: number; tradeRep: number; SoARep: number }
}

interface InfiltrationApi {
  getPossibleLocations(): Array<{ city: string; name: string }>
  getInfiltration(location: string): InfiltrationLocation
}

function getInfiltrationApi(ns: NS): InfiltrationApi | null {
  return (ns as NS & { infiltration?: InfiltrationApi }).infiltration ?? null
}

/** Same 0-100 scale shown on the infiltration intro screen. */
function displayRating(rawDifficulty: number): number {
  return (Math.min(rawDifficulty, MAX_DIFFICULTY) * 100) / MAX_DIFFICULTY
}

function tierLabel(rawDifficulty: number): string {
  if (rawDifficulty >= MAX_DIFFICULTY) return "Blocked"
  if (rawDifficulty >= 3) return "Impossible"
  if (rawDifficulty >= 2) return "Hard"
  if (rawDifficulty >= 1) return "Normal"
  return "Trivial"
}

export async function main(ns: NS): Promise<void> {
  const infiltration = getInfiltrationApi(ns)
  if (!infiltration) {
    ns.tprint("ERROR: ns.infiltration API is not available (game too old?)")
    return
  }

  const locations = infiltration.getPossibleLocations()
  const rows: Array<{
    rawDifficulty: number
    cells: string[]
  }> = []

  for (const loc of locations) {
    try {
      const data = infiltration.getInfiltration(loc.name)
      const rating = displayRating(data.difficulty)

      rows.push({
        rawDifficulty: data.difficulty,
        cells: [
          rating.toFixed(0),
          tierLabel(data.difficulty),
          data.location.city,
          data.location.name,
          String(data.maxClearanceLevel),
          String(data.startingSecurityLevel),
          ns.format.number(data.reward.sellCash),
          ns.format.number(data.reward.tradeRep),
        ],
      })
    } catch {
      // Location may be unavailable in this BitNode or city state.
    }
  }

  rows.sort((a, b) => a.rawDifficulty - b.rawDifficulty)

  const combatStats =
    ns.getPlayer().skills.strength +
    ns.getPlayer().skills.defense +
    ns.getPlayer().skills.dexterity +
    ns.getPlayer().skills.agility +
    ns.getPlayer().skills.charisma

  ns.tprint("")
  ns.tprint(`Infiltration targets (${rows.length}), sorted easiest first`)
  ns.tprint(
    `Your combat+cha total: ${combatStats} (str+def+dex+agi+cha). Rating is for your current stats.`
  )
  ns.tprint("Docs recommend rating ~43 or below (roughly Normal). Blocked = cannot start.")
  ns.tprint("")

  const table = buildTable({
    title: "Infiltration targets by difficulty",
    columns: [
      { header: "Rating", align: "right", minWidth: 6 },
      { header: "Tier", align: "left", minWidth: 10 },
      { header: "City", align: "left", minWidth: 12 },
      { header: "Location", align: "left", minWidth: 28 },
      { header: "Lvls", align: "right", minWidth: 4 },
      { header: "Sec", align: "right", minWidth: 3 },
      { header: "Cash", align: "right", minWidth: 10 },
      { header: "Rep", align: "right", minWidth: 10 },
    ],
    rows: rows.map((row) => row.cells),
  })

  ns.tprint(table)
}
