import { NS } from "@ns"
import { FloatingWindow } from "./libraries/floatingWindow.js"

export async function main(ns: NS) {
  const buyMode = ns.args[0] === "buy"
  const buyFlux = ns.args[1] === "flux"

  // If in buy mode, just purchase and exit
  if (buyMode) {
    await doPurchase(ns, buyFlux)
    return
  }

  const scriptName = ns.getScriptName()
  const hostname = ns.getHostname()
  const processes = ns.ps(hostname)

  for (const proc of processes) {
    if (proc.filename === scriptName && proc.pid !== ns.pid && proc.args.length === 0) {
      ns.kill(proc.pid)
    }
  }

  // Otherwise, create updating window
  await createAugmentsWindow(ns)
}

async function doPurchase(ns: NS, buyFlux: boolean) {
  const player = ns.getPlayer()
  const playerFactions = player.factions

  if (playerFactions.length === 0) {
    ns.tprint("You are not in any factions yet.")
    return
  }

  let { affordableSorted, neuroFluxInfo, factionReps, playerMoney } = getAugmentData(ns, playerFactions)

  ns.tprint("\n" + "=".repeat(120))
  ns.tprint(buyFlux ? "PURCHASING AUGMENTATIONS + TOPPING UP WITH NEUROFLUX" : "PURCHASING AUGMENTATIONS (prerequisites first)")
  ns.tprint("=".repeat(120))

  let purchaseCount = 0
  let totalSpent = 0

  // Always purchase regular augmentations first (whether buyFlux is true or not)
  if (affordableSorted.length > 0) {
    for (const aug of affordableSorted) {
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
  }

  // If buyFlux is true, top up with NeuroFlux Governor
  if (buyFlux && neuroFluxInfo) {
    // Recalculate remaining money after purchasing regular augmentations
    const remainingMoney = ns.getPlayer().money
    const AUGMENT_PRICE_MULT = 1.9
    const validFaction = neuroFluxInfo.factions.find((f) => (factionReps.get(f) ?? 0) >= neuroFluxInfo.repReq)

    if (!validFaction) {
      ns.tprint(`✗ No valid faction found for: ${neuroFluxInfo.name}`)
    } else {
      let currentPrice = neuroFluxInfo.price
      let currentMoney = remainingMoney

      while (currentMoney >= currentPrice) {
        const success = ns.singularity.purchaseAugmentation(validFaction, neuroFluxInfo.name)
        if (success) {
          ns.tprint(`✓ Purchased: ${neuroFluxInfo.name} from ${validFaction} for ${ns.formatNumber(currentPrice)}`)
          purchaseCount++
          totalSpent += currentPrice
          currentMoney -= currentPrice
          currentPrice *= AUGMENT_PRICE_MULT
        } else {
          ns.tprint(`✗ Failed to purchase: ${neuroFluxInfo.name} from ${validFaction}`)
          break
        }
      }
    }
  }

  ns.tprint("=".repeat(120))
  ns.tprint(`Purchased ${purchaseCount} augmentations for ${ns.formatNumber(totalSpent)}`)
}

async function createAugmentsWindow(ns: NS) {
  // Remove existing augments window if it exists
  const existingWindow = eval("document").querySelector("#augments-window")
  if (existingWindow) {
    existingWindow.remove()
  }

  const player = ns.getPlayer()

  if (player.factions.length === 0) {
    ns.tprint("You are not in any factions yet.")
    return
  }

  // Extract primary text color from game's CSS
  const primaryElement = eval("document").querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = eval("window").getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create container that will be updated
  const containerDiv = eval("document").createElement("div")
  containerDiv.style.fontFamily = "monospace"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  function updateTable() {
    const { affordableSorted, unaffordable, neuroFluxInfo, affordable, playerMoney, factionReps } = getAugmentData(
      ns,
      ns.getPlayer().factions
    )

    // Calculate column widths
    const orderCol = "#"
    const nameCol = "Augmentation"
    const factionCol = "Faction"
    const priceCol = "Price"
    const repCol = "Rep Req"
    const ownedCol = "Own"
    const statusCol = "Stat"

    let orderLen = orderCol.length
    let nameLen = nameCol.length
    let factionLen = factionCol.length
    let priceLen = priceCol.length
    let repLen = repCol.length
    let ownedLen = ownedCol.length
    let statusLen = statusCol.length

    const allAugs = [...affordableSorted, ...unaffordable]
    if (neuroFluxInfo) allAugs.push(neuroFluxInfo)

    orderLen = Math.max(orderLen, affordableSorted.length.toString().length)

    for (const aug of allAugs) {
      nameLen = Math.max(nameLen, aug.name.length)
      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
      const factionText = (validFactions.length > 0 ? validFactions : aug.factions).join(", ")
      factionLen = Math.max(factionLen, Math.min(factionText.length, 30))
      priceLen = Math.max(priceLen, ns.formatNumber(aug.price).length)
      repLen = Math.max(repLen, ns.formatNumber(aug.repReq).length)
    }

    // Helper to truncate faction names
    function formatFactionText(factions: string[], maxWidth: number): string {
      const joined = factions.join(", ")
      if (joined.length <= maxWidth) return joined
      return joined.substring(0, maxWidth - 3) + "..."
    }

    // Build table with HTML spans for coloring
    interface TableRow {
      order: string
      name: string
      faction: string
      price: string
      priceRed: boolean
      rep: string
      repRed: boolean
      owned: string
      status: string
    }

    const rows: TableRow[] = []

    // Affordable section
    let orderNum = 1
    for (const aug of affordableSorted) {
      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
      rows.push({
        order: orderNum.toString().padStart(orderLen),
        name: aug.name.padEnd(nameLen),
        faction: formatFactionText(validFactions, factionLen).padEnd(factionLen),
        price: ns.formatNumber(aug.price).padStart(priceLen),
        priceRed: false,
        rep: ns.formatNumber(aug.repReq).padStart(repLen),
        repRed: false,
        owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
        status: "✓".padStart(statusLen),
      })
      orderNum++
    }

    // Unaffordable section
    for (const aug of unaffordable) {
      const hasEnoughMoney = playerMoney >= aug.price
      const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)

      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
      const factionList = validFactions.length > 0 ? validFactions : aug.factions

      let statusSymbol = "✗"
      if (!hasEnoughMoney && !hasEnoughRep) statusSymbol = "✗✗"
      else if (!hasEnoughMoney) statusSymbol = "✗$"
      else if (!hasEnoughRep) statusSymbol = "✗R"

      rows.push({
        order: " ".repeat(orderLen),
        name: aug.name.padEnd(nameLen),
        faction: formatFactionText(factionList, factionLen).padEnd(factionLen),
        price: ns.formatNumber(aug.price).padStart(priceLen),
        priceRed: !hasEnoughMoney,
        rep: ns.formatNumber(aug.repReq).padStart(repLen),
        repRed: !hasEnoughRep,
        owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
        status: statusSymbol.padStart(statusLen),
      })
    }

    // NeuroFlux section
    if (neuroFluxInfo) {
      const hasEnoughMoney = playerMoney >= neuroFluxInfo.price
      const hasEnoughRep = neuroFluxInfo.factions.some(
        (faction) => (factionReps.get(faction) ?? 0) >= neuroFluxInfo.repReq
      )

      const canAfford = hasEnoughMoney && hasEnoughRep

      // Calculate how many NeuroFlux can be afforded
      const AUGMENT_PRICE_MULT = 1.9
      let count = 0
      let totalCost = 0
      let currentPrice = neuroFluxInfo.price

      if (canAfford) {
        let remainingMoney = playerMoney
        while (remainingMoney >= currentPrice) {
          remainingMoney -= currentPrice
          totalCost += currentPrice
          count++
          currentPrice *= AUGMENT_PRICE_MULT
        }
      }

      const nameText = count > 0 ? `${neuroFluxInfo.name} (x${count})` : neuroFluxInfo.name

      rows.push({
        order: " ".repeat(orderLen),
        name: nameText.padEnd(nameLen),
        faction: formatFactionText(neuroFluxInfo.factions, factionLen).padEnd(factionLen),
        price: ns.formatNumber(neuroFluxInfo.price).padStart(priceLen),
        priceRed: !hasEnoughMoney,
        rep: ns.formatNumber(neuroFluxInfo.repReq).padStart(repLen),
        repRed: !hasEnoughRep,
        owned: (neuroFluxInfo.owned ? "Y" : " ").padStart(ownedLen),
        status: (canAfford ? "~" : "✗").padStart(statusLen),
      })
    }

    // Build table header and footer
    const tableHeader =
      `┏━${"━".repeat(orderLen)}━┳━${"━".repeat(nameLen)}━┳━${"━".repeat(factionLen)}━┳━${"━".repeat(priceLen)}━┳━${"━".repeat(repLen)}━┳━${"━".repeat(ownedLen)}━┳━${"━".repeat(statusLen)}━┓\n` +
      `┃ ${orderCol.padStart(orderLen)} ┃ ${nameCol.padEnd(nameLen)} ┃ ${factionCol.padEnd(factionLen)} ┃ ${priceCol.padStart(priceLen)} ┃ ${repCol.padStart(repLen)} ┃ ${ownedCol.padStart(ownedLen)} ┃ ${statusCol.padStart(statusLen)} ┃\n` +
      `┣━${"━".repeat(orderLen)}━╋━${"━".repeat(nameLen)}━╋━${"━".repeat(factionLen)}━╋━${"━".repeat(priceLen)}━╋━${"━".repeat(repLen)}━╋━${"━".repeat(ownedLen)}━╋━${"━".repeat(statusLen)}━┫\n`

    const tableFooter =
      `┗━${"━".repeat(orderLen)}━┻━${"━".repeat(nameLen)}━┻━${"━".repeat(factionLen)}━┻━${"━".repeat(priceLen)}━┻━${"━".repeat(repLen)}━┻━${"━".repeat(ownedLen)}━┻━${"━".repeat(statusLen)}━┛\n` +
      `\nAffordable: ${affordable.length} | Not affordable: ${unaffordable.length} | Total: ${allAugs.length}\n` +
      `Current money: ${ns.formatNumber(playerMoney)}`

    // Clear and rebuild container
    containerDiv.innerHTML = ""

    // Add header
    const headerSpan = eval("document").createElement("span")
    headerSpan.textContent = tableHeader
    containerDiv.appendChild(headerSpan)

    // Add rows with conditional coloring
    for (const row of rows) {
      const rowSpan = eval("document").createElement("span")
      rowSpan.textContent = `┃ ${row.order} ┃ ${row.name} ┃ ${row.faction} ┃ `
      containerDiv.appendChild(rowSpan)

      const priceSpan = eval("document").createElement("span")
      priceSpan.textContent = row.price
      if (row.priceRed) priceSpan.style.color = "#ff4444"
      containerDiv.appendChild(priceSpan)

      const midSpan = eval("document").createElement("span")
      midSpan.textContent = " ┃ "
      containerDiv.appendChild(midSpan)

      const repSpan = eval("document").createElement("span")
      repSpan.textContent = row.rep
      if (row.repRed) repSpan.style.color = "#ff4444"
      containerDiv.appendChild(repSpan)

      const endSpan = eval("document").createElement("span")
      endSpan.textContent = ` ┃ ${row.owned} ┃ ${row.status} ┃\n`
      containerDiv.appendChild(endSpan)
    }

    // Add footer
    const footerSpan = eval("document").createElement("span")
    footerSpan.textContent = tableFooter
    containerDiv.appendChild(footerSpan)
  }

  // Initial render
  updateTable()

  // Calculate content width based on table width
  const firstData = getAugmentData(ns, ns.getPlayer().factions)
  const orderLen = Math.max(1, firstData.affordableSorted.length.toString().length)
  const contentWidth = Math.min((orderLen + 50 + 30 + 20 + 15 + 3 + 4 + 20) * 7.2 + 40, eval("window").innerWidth - 100)

  // Create floating window
  new FloatingWindow({
    title: `Augmentations (✓ = affordable, ✗ = not affordable, ~ = NeuroFlux)`,
    content: containerDiv,
    width: contentWidth,
    height: 600,
    id: "augments-window",
  })

  // Update every second
  while (true) {
    await ns.sleep(1000)
    // Check if window still exists
    if (!eval("document").querySelector("#augments-window")) {
      break
    }
    updateTable()
  }
}

// Collect augmentation data
interface AugmentInfo {
  name: string
  factions: string[] // All factions that offer this augment
  price: number
  repReq: number
  owned: boolean
  prereqs: string[] // Prerequisites for this augment
}

function getAugmentData(ns: NS, playerFactions: string[]) {
  const augmentMap = new Map<string, AugmentInfo>()
  let neuroFluxInfo: AugmentInfo | null = null

  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)

    for (const augName of augments) {
      const price = ns.singularity.getAugmentationPrice(augName)
      const repReq = ns.singularity.getAugmentationRepReq(augName)
      const owned = ns.singularity.getOwnedAugmentations(true).includes(augName)
      const prereqs = ns.singularity.getAugmentationPrereq(augName)

      // Handle NeuroFlux Governor separately
      if (augName.startsWith("NeuroFlux Governor")) {
        if (!neuroFluxInfo) {
          neuroFluxInfo = {
            name: augName,
            factions: [faction],
            price: price,
            repReq: repReq,
            owned: owned,
            prereqs: prereqs,
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
          prereqs: prereqs,
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

  // Topological sort to handle prerequisites
  function topologicalSort(augs: AugmentInfo[]): AugmentInfo[] {
    const sorted: AugmentInfo[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const augsByName = new Map(augs.map((aug) => [aug.name, aug]))

    function visit(aug: AugmentInfo) {
      if (visited.has(aug.name)) return
      if (visiting.has(aug.name)) {
        // Circular dependency - shouldn't happen in Bitburner but handle gracefully
        return
      }

      visiting.add(aug.name)

      // Visit prerequisites first
      for (const prereqName of aug.prereqs) {
        const prereq = augsByName.get(prereqName)
        if (prereq) {
          visit(prereq)
        }
      }

      visiting.delete(aug.name)
      visited.add(aug.name)
      sorted.push(aug)
    }

    for (const aug of augs) {
      visit(aug)
    }

    return sorted
  }

  // Sort affordable with prerequisites first
  const affordableSorted = topologicalSort(affordable)

  // Sort unaffordable by price (most expensive first)
  unaffordable.sort((a, b) => b.price - a.price)

  return {
    affordableSorted,
    unaffordable,
    neuroFluxInfo,
    affordable,
    playerMoney,
    factionReps,
  }
}
