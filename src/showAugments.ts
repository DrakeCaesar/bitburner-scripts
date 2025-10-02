import { NS } from "@ns"

export async function main(ns: NS) {
  const buyMode = ns.args[0] === "buy"
  const buyFlux = ns.args[1] === "flux"
  const player = ns.getPlayer()

  // Get all factions the player is in
  const playerFactions = player.factions

  if (playerFactions.length === 0) {
    ns.tprint("You are not in any factions yet.")
    return
  }

  // Collect all augmentations with their details
  interface AugmentInfo {
    name: string
    factions: string[] // All factions that offer this augment
    price: number
    repReq: number
    owned: boolean
  }

  const augmentMap = new Map<string, AugmentInfo>()
  let neuroFluxInfo: AugmentInfo | null = null

  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)

    for (const augName of augments) {
      const price = ns.singularity.getAugmentationPrice(augName)
      const repReq = ns.singularity.getAugmentationRepReq(augName)
      const owned = ns.singularity.getOwnedAugmentations(true).includes(augName)

      // Handle NeuroFlux Governor separately
      if (augName.startsWith("NeuroFlux Governor")) {
        if (!neuroFluxInfo) {
          neuroFluxInfo = {
            name: augName,
            factions: [faction],
            price: price,
            repReq: repReq,
            owned: owned,
          }
        } else {
          neuroFluxInfo.factions.push(faction)
        }
        continue
      }

      if (augmentMap.has(augName)) {
        // Add this faction to the existing entry
        augmentMap.get(augName)!.factions.push(faction)
      } else {
        augmentMap.set(augName, {
          name: augName,
          factions: [faction],
          price: price,
          repReq: repReq,
          owned: owned,
        })
      }
    }
  }

  // Get player stats
  const playerMoney = ns.getPlayer().money
  const factionReps = new Map<string, number>()
  for (const faction of playerFactions) {
    factionReps.set(faction, ns.singularity.getFactionRep(faction))
  }

  // Separate into affordable and unaffordable
  const affordable: AugmentInfo[] = []
  const unaffordable: AugmentInfo[] = []

  for (const aug of augmentMap.values()) {
    const hasEnoughMoney = playerMoney >= aug.price
    // Check if we have enough rep in ANY of the factions that offer this augment
    const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)

    if (hasEnoughMoney && hasEnoughRep && !aug.owned) {
      affordable.push(aug)
    } else {
      unaffordable.push(aug)
    }
  }

  // Sort both lists by price (most expensive first)
  affordable.sort((a, b) => b.price - a.price)
  unaffordable.sort((a, b) => b.price - a.price)

  // Display table
  ns.tprint("\n" + "=".repeat(120))
  ns.tprint("AVAILABLE AUGMENTATIONS")
  ns.tprint("=".repeat(120))

  // Header
  const header =
    "AUGMENTATION".padEnd(50) +
    "FACTION".padEnd(30) +
    "PRICE".padEnd(20) +
    "REP REQ".padEnd(15) +
    "OWNED"
  ns.tprint(header)
  ns.tprint("-".repeat(120))

  // Helper function to format faction column with truncation
  function formatFactionCol(factions: string[], maxWidth = 30): string {
    const joined = factions.join(", ")
    if (joined.length <= maxWidth) {
      return joined.padEnd(maxWidth)
    }
    return (joined.substring(0, maxWidth - 3) + "...").padEnd(maxWidth)
  }

  // Display affordable augmentations first
  if (affordable.length > 0) {
    ns.tprint("\x1b[32mAFFORDABLE:\x1b[0m")
    for (const aug of affordable) {
      const nameCol = aug.name.padEnd(50)
      // Show faction(s) where we have enough rep
      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
      const factionCol = formatFactionCol(validFactions)
      const priceCol = ns.formatNumber(aug.price).padEnd(20)
      const repCol = ns.formatNumber(aug.repReq).padEnd(15)
      const ownedCol = aug.owned ? "YES" : "NO"

      ns.tprint(nameCol + factionCol + priceCol + repCol + ownedCol)
    }
  }

  // Display unaffordable augmentations
  if (unaffordable.length > 0) {
    ns.tprint("\n\x1b[31mNOT AFFORDABLE:\x1b[0m")
    for (const aug of unaffordable) {
      const hasEnoughMoney = playerMoney >= aug.price
      const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)

      const nameCol = aug.name.padEnd(50)
      const factionCol = formatFactionCol(aug.factions)

      // Color price red if not enough money
      const priceStr = ns.formatNumber(aug.price).padEnd(20)
      const priceCol = hasEnoughMoney ? priceStr : `\x1b[31m${priceStr}\x1b[0m`

      // Color rep red if not enough reputation
      const repStr = ns.formatNumber(aug.repReq).padEnd(15)
      const repCol = hasEnoughRep ? repStr : `\x1b[31m${repStr}\x1b[0m`

      const ownedCol = aug.owned ? "YES" : "NO"

      ns.tprint(nameCol + factionCol + priceCol + repCol + ownedCol)
    }
  }

  // Always display NeuroFlux Governor at the end
  if (neuroFluxInfo) {
    ns.tprint("\n\x1b[36mNEUROFLUX GOVERNOR:\x1b[0m")
    const hasEnoughMoney = playerMoney >= neuroFluxInfo.price
    const hasEnoughRep = neuroFluxInfo.factions.some((faction) => (factionReps.get(faction) ?? 0) >= neuroFluxInfo.repReq)

    const nameCol = neuroFluxInfo.name.padEnd(50)
    const factionCol = formatFactionCol(neuroFluxInfo.factions)

    const priceStr = ns.formatNumber(neuroFluxInfo.price).padEnd(20)
    const priceCol = hasEnoughMoney ? priceStr : `\x1b[31m${priceStr}\x1b[0m`

    const repStr = ns.formatNumber(neuroFluxInfo.repReq).padEnd(15)
    const repCol = hasEnoughRep ? repStr : `\x1b[31m${repStr}\x1b[0m`

    const ownedCol = neuroFluxInfo.owned ? "YES" : "NO"

    ns.tprint(nameCol + factionCol + priceCol + repCol + ownedCol)
  }

  ns.tprint("=".repeat(120))
  ns.tprint(`Affordable: ${affordable.length} | Not affordable: ${unaffordable.length} | Total: ${affordable.length + unaffordable.length}`)
  ns.tprint(`Current money: ${ns.formatNumber(playerMoney)}`)

  // Buy mode - purchase all affordable augmentations
  if (buyMode) {
    const toPurchase = buyFlux && neuroFluxInfo ? [neuroFluxInfo] : affordable

    if (toPurchase.length === 0) {
      ns.tprint("\nNo augmentations to purchase.")
      return
    }

    ns.tprint("\n" + "=".repeat(120))
    ns.tprint(buyFlux ? "PURCHASING NEUROFLUX GOVERNOR" : "PURCHASING AUGMENTATIONS (most expensive first)")
    ns.tprint("=".repeat(120))

    let purchaseCount = 0
    let totalSpent = 0

    for (const aug of toPurchase) {
      // Find a faction where we have enough rep to buy from
      const validFaction = aug.factions.find((f) => (factionReps.get(f) ?? 0) >= aug.repReq)

      if (!validFaction) {
        ns.tprint(`✗ No valid faction found for: ${aug.name}`)
        continue
      }

      const success = ns.singularity.purchaseAugmentation(validFaction, aug.name)
      if (success) {
        ns.tprint(`✓ Purchased: ${aug.name} from ${validFaction} for ${ns.formatNumber(aug.price)}`)
        purchaseCount++
        totalSpent += aug.price
      } else {
        ns.tprint(`✗ Failed to purchase: ${aug.name} from ${validFaction}`)
      }
    }

    ns.tprint("=".repeat(120))
    ns.tprint(`Purchased ${purchaseCount} augmentations for ${ns.formatNumber(totalSpent)}`)
  }
}
