import { NS } from "@ns"

export async function main(ns: NS) {
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
    faction: string
    price: number
    repReq: number
    owned: boolean
  }

  const augmentMap = new Map<string, AugmentInfo>()

  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)

    for (const augName of augments) {
      // Skip if already in map (show from first faction that offers it)
      if (augmentMap.has(augName)) continue

      const price = ns.singularity.getAugmentationPrice(augName)
      const repReq = ns.singularity.getAugmentationRepReq(augName)
      const owned = ns.singularity.getOwnedAugmentations(true).includes(augName)

      augmentMap.set(augName, {
        name: augName,
        faction: faction,
        price: price,
        repReq: repReq,
        owned: owned,
      })
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
    const hasEnoughRep = (factionReps.get(aug.faction) ?? 0) >= aug.repReq

    if (hasEnoughMoney && hasEnoughRep) {
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
    "FACTION".padEnd(25) +
    "PRICE".padEnd(20) +
    "REP REQ".padEnd(15) +
    "OWNED"
  ns.tprint(header)
  ns.tprint("-".repeat(120))

  // Display affordable augmentations first
  if (affordable.length > 0) {
    ns.tprint("\x1b[32mAFFORDABLE:\x1b[0m")
    for (const aug of affordable) {
      const nameCol = aug.name.padEnd(50)
      const factionCol = aug.faction.padEnd(25)
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
      const hasEnoughRep = (factionReps.get(aug.faction) ?? 0) >= aug.repReq

      const nameCol = aug.name.padEnd(50)
      const factionCol = aug.faction.padEnd(25)

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

  ns.tprint("=".repeat(120))
  ns.tprint(`Affordable: ${affordable.length} | Not affordable: ${unaffordable.length} | Total: ${affordable.length + unaffordable.length}`)
  ns.tprint(`Current money: ${ns.formatNumber(playerMoney)}`)
}
