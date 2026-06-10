import { NS } from "@ns"
import { getAugmentCatalog } from "./libraries/augmentations.js"

export async function main(ns: NS) {
  const outputFile = ns.args[0] ? String(ns.args[0]) : "augments-export.txt"

  ns.tprint("Collecting augmentation data from catalog...")

  const catalog = getAugmentCatalog(ns)
  const augmentArray = [...catalog.values()]
    .map((entry) => ({
      name: entry.name,
      factions: [...entry.factions],
      price: ns.singularity.getAugmentationPrice(entry.name),
      basePrice: entry.basePrice,
      repReq: entry.repReq,
      prereqs: [...entry.prereqs],
      stats: entry.stats,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const output = {
    exportDate: new Date().toISOString(),
    totalAugmentations: augmentArray.length,
    augmentations: augmentArray,
  }

  const jsonOutput = JSON.stringify(output, null, 2)
  await ns.write(outputFile, jsonOutput, "w")

  ns.tprint(`\n${"=".repeat(80)}`)
  ns.tprint(`Successfully exported ${augmentArray.length} augmentations to ${outputFile}`)
  ns.tprint(`${"=".repeat(80)}\n`)

  const totalFactionCount = augmentArray.reduce((sum, aug) => sum + aug.factions.length, 0)
  const avgFactionsPerAug = (totalFactionCount / augmentArray.length).toFixed(2)

  ns.tprint(`Statistics:`)
  ns.tprint(`  - Total augmentations: ${augmentArray.length}`)
  ns.tprint(`  - Average factions per augmentation: ${avgFactionsPerAug}`)
  ns.tprint(`  - Augmentations with multiple factions: ${augmentArray.filter((a) => a.factions.length > 1).length}`)
  ns.tprint(`  - Augmentations exclusive to one faction: ${augmentArray.filter((a) => a.factions.length === 1).length}`)
}
