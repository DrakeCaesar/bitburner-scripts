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
  ns.tprint(
    buyFlux
      ? "PURCHASING AUGMENTATIONS + TOPPING UP WITH NEUROFLUX"
      : "PURCHASING AUGMENTATIONS (optimal order, within budget)"
  )
  ns.tprint("=".repeat(120))

  let purchaseCount = 0
  let totalSpent = 0

  // Calculate cumulative costs to determine affordability
  const AUGMENT_PRICE_MULT = 1.9
  let cumulativeCost = 0
  const affordableWithBudget: typeof affordableSorted = []

  for (let i = 0; i < affordableSorted.length; i++) {
    const adjustedPrice = affordableSorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    if (cumulativeCost <= playerMoney) {
      affordableWithBudget.push(affordableSorted[i])
    } else {
      // Stop once we exceed budget
      break
    }
  }

  // Purchase augmentations we can actually afford
  if (affordableWithBudget.length > 0) {
    ns.tprint(
      `Can afford ${affordableWithBudget.length} of ${affordableSorted.length} augmentations (total cost: ${ns.formatNumber(cumulativeCost > playerMoney ? playerMoney : cumulativeCost)})`
    )

    for (const aug of affordableWithBudget) {
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
  } else if (affordableSorted.length > 0) {
    ns.tprint(
      `Cannot afford any augmentations. Cheapest would cost ${ns.formatNumber(affordableSorted[0].price)}, you have ${ns.formatNumber(playerMoney)}`
    )
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
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  function updateTable() {
    const { affordableSorted, tooExpensiveCumulative, unaffordable, neuroFluxInfo, playerMoney, factionReps } =
      getAugmentData(ns, ns.getPlayer().factions)

    // Calculate column widths
    const orderCol = "#"
    const nameCol = "Augmentation"
    const factionCol = "Faction"
    const priceCol = "Price"
    const adjustedCol = "Adj Price"
    const cumulativeCol = "Total Cost"
    const repCol = "Rep Req"
    const ownedCol = "Own"
    const statusCol = "Stat"

    let orderLen = orderCol.length
    let nameLen = nameCol.length
    let factionLen = factionCol.length
    let priceLen = priceCol.length
    let adjustedLen = adjustedCol.length
    let cumulativeLen = cumulativeCol.length
    let repLen = repCol.length
    let ownedLen = ownedCol.length
    let statusLen = statusCol.length

    const allAugs = [...affordableSorted, ...tooExpensiveCumulative, ...unaffordable]
    if (neuroFluxInfo) allAugs.push(neuroFluxInfo)

    // Calculate adjusted prices and cumulative costs for affordable + too expensive augments
    const AUGMENT_PRICE_MULT = 1.9
    let cumulativeCost = 0
    const adjustedPrices: number[] = []
    const cumulativeCosts: number[] = []
    const combinedList = [...affordableSorted, ...tooExpensiveCumulative]

    for (let i = 0; i < combinedList.length; i++) {
      const adjustedPrice = combinedList[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
      adjustedPrices.push(adjustedPrice)
      cumulativeCost += adjustedPrice
      cumulativeCosts.push(cumulativeCost)
    }

    // Pre-calculate NeuroFlux count for order column width
    let neuroFluxCount = 0
    if (neuroFluxInfo) {
      const NEUROFLUX_MULT = 1.14
      const lastAffordableCost = affordableSorted.length > 0 ? cumulativeCosts[affordableSorted.length - 1] : 0
      let remainingMoney = playerMoney - lastAffordableCost
      const positionOffset = affordableSorted.length
      let currentPrice = neuroFluxInfo.price * Math.pow(AUGMENT_PRICE_MULT, positionOffset)
      let currentRepReq = neuroFluxInfo.repReq
      const maxFactionRep = Math.max(...neuroFluxInfo.factions.map((f) => factionReps.get(f) ?? 0))

      while (remainingMoney >= currentPrice && maxFactionRep >= currentRepReq) {
        neuroFluxCount++
        remainingMoney -= currentPrice
        currentPrice *= AUGMENT_PRICE_MULT * NEUROFLUX_MULT
        currentRepReq *= NEUROFLUX_MULT
      }
    }

    // Calculate order column width based on total numbered items
    const totalNumberedItems = affordableSorted.length + neuroFluxCount
    orderLen = Math.max(orderLen, totalNumberedItems.toString().length)

    for (const aug of allAugs) {
      nameLen = Math.max(nameLen, aug.name.length)
      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
      const factionText = (validFactions.length > 0 ? validFactions : aug.factions).join(", ")
      factionLen = Math.max(factionLen, Math.min(factionText.length, 30))
      priceLen = Math.max(priceLen, ns.formatNumber(aug.price).length)
      repLen = Math.max(repLen, ns.formatNumber(aug.repReq).length)
    }

    // Update adjusted and cumulative column widths based on calculated costs
    for (let i = 0; i < adjustedPrices.length; i++) {
      adjustedLen = Math.max(adjustedLen, ns.formatNumber(adjustedPrices[i]).length)
      cumulativeLen = Math.max(cumulativeLen, ns.formatNumber(cumulativeCosts[i]).length)
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
      adjusted: string
      adjustedRed: boolean
      cumulative: string
      cumulativeRed: boolean
      rep: string
      repRed: boolean
      owned: string
      status: string
    }

    const rows: TableRow[] = []

    // Affordable section
    let orderNum = 1
    for (let i = 0; i < affordableSorted.length; i++) {
      const aug = affordableSorted[i]
      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
      rows.push({
        order: orderNum.toString().padStart(orderLen),
        name: aug.name.padEnd(nameLen),
        faction: formatFactionText(validFactions, factionLen).padEnd(factionLen),
        price: ns.formatNumber(aug.price).padStart(priceLen),
        priceRed: false,
        adjusted: ns.formatNumber(adjustedPrices[i]).padStart(adjustedLen),
        adjustedRed: false,
        cumulative: ns.formatNumber(cumulativeCosts[i]).padStart(cumulativeLen),
        cumulativeRed: playerMoney < cumulativeCosts[i],
        rep: ns.formatNumber(aug.repReq).padStart(repLen),
        repRed: false,
        owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
        status: "✓".padStart(statusLen),
      })
      orderNum++
    }

    // Too expensive (cumulative) section - have rep but can't afford due to price escalation
    for (let i = 0; i < tooExpensiveCumulative.length; i++) {
      const aug = tooExpensiveCumulative[i]
      const adjustedIdx = affordableSorted.length + i
      const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)

      rows.push({
        order: " ".repeat(orderLen),
        name: aug.name.padEnd(nameLen),
        faction: formatFactionText(validFactions, factionLen).padEnd(factionLen),
        price: ns.formatNumber(aug.price).padStart(priceLen),
        priceRed: false,
        adjusted: ns.formatNumber(adjustedPrices[adjustedIdx]).padStart(adjustedLen),
        adjustedRed: true,
        cumulative: ns.formatNumber(cumulativeCosts[adjustedIdx]).padStart(cumulativeLen),
        cumulativeRed: true,
        rep: ns.formatNumber(aug.repReq).padStart(repLen),
        repRed: false,
        owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
        status: "✗$".padStart(statusLen),
      })
    }

    // Unaffordable section - sort by price (most expensive first)
    const sortedUnaffordable = [...unaffordable].sort((a, b) => b.price - a.price)

    for (const aug of sortedUnaffordable) {
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
        adjusted: " ".repeat(adjustedLen),
        adjustedRed: false,
        cumulative: " ".repeat(cumulativeLen),
        cumulativeRed: false,
        rep: ns.formatNumber(aug.repReq).padStart(repLen),
        repRed: !hasEnoughRep,
        owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
        status: statusSymbol.padStart(statusLen),
      })
    }

    // NeuroFlux section - expand to show individual purchases after all affordable regular augments
    // Note: NeuroFlux can be purchased multiple times, so we show it even if "owned"
    if (neuroFluxInfo) {
      // NeuroFlux Governor's price and rep requirements both increase with each level
      const NEUROFLUX_REP_MULT = 1.9 // Reputation requirement multiplier per level

      // Start from the money remaining after purchasing affordable regular augments only
      const lastAffordableCost = affordableSorted.length > 0 ? cumulativeCosts[affordableSorted.length - 1] : 0
      let remainingMoney = playerMoney - lastAffordableCost

      // Calculate position offset (number of affordable augments purchased affects price multiplier)
      const positionOffset = affordableSorted.length
      let currentPrice = neuroFluxInfo.price * Math.pow(AUGMENT_PRICE_MULT, positionOffset)
      let currentRepReq = neuroFluxInfo.repReq
      let neuroFluxCumulative = lastAffordableCost
      let neuroFluxIndex = 0

      // Get max rep across all factions offering NeuroFlux
      const maxFactionRep = Math.max(...neuroFluxInfo.factions.map((f) => factionReps.get(f) ?? 0))

      // Create a row for each NeuroFlux purchase we can afford
      while (remainingMoney >= currentPrice && maxFactionRep >= currentRepReq) {
        neuroFluxCumulative += currentPrice

        rows.push({
          order: orderNum.toString().padStart(orderLen),
          name: neuroFluxInfo.name.padEnd(nameLen),
          faction: formatFactionText(neuroFluxInfo.factions, factionLen).padEnd(factionLen),
          price: ns.formatNumber(neuroFluxInfo.price).padStart(priceLen),
          priceRed: false,
          adjusted: ns.formatNumber(currentPrice).padStart(adjustedLen),
          adjustedRed: false,
          cumulative: ns.formatNumber(neuroFluxCumulative).padStart(cumulativeLen),
          cumulativeRed: false,
          rep: ns.formatNumber(currentRepReq).padStart(repLen),
          repRed: false,
          owned: (neuroFluxInfo.owned ? "Y" : " ").padStart(ownedLen),
          status: "~".padStart(statusLen),
        })

        remainingMoney -= currentPrice
        currentPrice *= AUGMENT_PRICE_MULT
        currentRepReq *= NEUROFLUX_REP_MULT
        neuroFluxIndex++
        orderNum++
      }

      // If we can't afford even one, or don't have rep, show one row indicating unavailability
      if (neuroFluxIndex === 0) {
        const basePrice = neuroFluxInfo.price * Math.pow(AUGMENT_PRICE_MULT, positionOffset)
        const canAffordMoney = remainingMoney >= basePrice
        const hasEnoughRep = maxFactionRep >= currentRepReq

        let statusSymbol = "✗"
        if (!canAffordMoney && !hasEnoughRep) statusSymbol = "✗✗"
        else if (!canAffordMoney) statusSymbol = "✗$"
        else if (!hasEnoughRep) statusSymbol = "✗R"

        rows.push({
          order: " ".repeat(orderLen),
          name: neuroFluxInfo.name.padEnd(nameLen),
          faction: formatFactionText(neuroFluxInfo.factions, factionLen).padEnd(factionLen),
          price: ns.formatNumber(neuroFluxInfo.price).padStart(priceLen),
          priceRed: !canAffordMoney,
          adjusted: ns.formatNumber(basePrice).padStart(adjustedLen),
          adjustedRed: !canAffordMoney,
          cumulative: " ".repeat(cumulativeLen),
          cumulativeRed: false,
          rep: ns.formatNumber(currentRepReq).padStart(repLen),
          repRed: !hasEnoughRep,
          owned: (neuroFluxInfo.owned ? "Y" : " ").padStart(ownedLen),
          status: statusSymbol.padStart(statusLen),
        })
      }
    }

    // Build table header and footer
    const tableHeader =
      `┏━${"━".repeat(orderLen)}━┳━${"━".repeat(nameLen)}━┳━${"━".repeat(factionLen)}━┳━${"━".repeat(priceLen)}━┳━${"━".repeat(adjustedLen)}━┳━${"━".repeat(cumulativeLen)}━┳━${"━".repeat(repLen)}━┳━${"━".repeat(ownedLen)}━┳━${"━".repeat(statusLen)}━┓\n` +
      `┃ ${orderCol.padStart(orderLen)} ┃ ${nameCol.padEnd(nameLen)} ┃ ${factionCol.padEnd(factionLen)} ┃ ${priceCol.padStart(priceLen)} ┃ ${adjustedCol.padStart(adjustedLen)} ┃ ${cumulativeCol.padStart(cumulativeLen)} ┃ ${repCol.padStart(repLen)} ┃ ${ownedCol.padStart(ownedLen)} ┃ ${statusCol.padStart(statusLen)} ┃\n` +
      `┣━${"━".repeat(orderLen)}━╋━${"━".repeat(nameLen)}━╋━${"━".repeat(factionLen)}━╋━${"━".repeat(priceLen)}━╋━${"━".repeat(adjustedLen)}━╋━${"━".repeat(cumulativeLen)}━╋━${"━".repeat(repLen)}━╋━${"━".repeat(ownedLen)}━╋━${"━".repeat(statusLen)}━┫\n`

    const tableFooter =
      `┗━${"━".repeat(orderLen)}━┻━${"━".repeat(nameLen)}━┻━${"━".repeat(factionLen)}━┻━${"━".repeat(priceLen)}━┻━${"━".repeat(adjustedLen)}━┻━${"━".repeat(cumulativeLen)}━┻━${"━".repeat(repLen)}━┻━${"━".repeat(ownedLen)}━┻━${"━".repeat(statusLen)}━┛\n` +
      `\nAffordable: ${affordableSorted.length} | Too expensive (cumulative): ${tooExpensiveCumulative.length} | No rep: ${unaffordable.length} | Total: ${allAugs.length}\n` +
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

      const midSpan1 = eval("document").createElement("span")
      midSpan1.textContent = " ┃ "
      containerDiv.appendChild(midSpan1)

      const adjustedSpan = eval("document").createElement("span")
      adjustedSpan.textContent = row.adjusted
      if (row.adjustedRed) adjustedSpan.style.color = "#ff4444"
      containerDiv.appendChild(adjustedSpan)

      const midSpan2 = eval("document").createElement("span")
      midSpan2.textContent = " ┃ "
      containerDiv.appendChild(midSpan2)

      const cumulativeSpan = eval("document").createElement("span")
      cumulativeSpan.textContent = row.cumulative
      if (row.cumulativeRed) cumulativeSpan.style.color = "#ff4444"
      containerDiv.appendChild(cumulativeSpan)

      const midSpan3 = eval("document").createElement("span")
      midSpan3.textContent = " ┃ "
      containerDiv.appendChild(midSpan3)

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
  const contentWidth = Math.min(
    (orderLen + 50 + 30 + 20 + 15 + 20 + 15 + 3 + 4 + 20) * 7.2 + 40,
    eval("window").innerWidth - 100
  )

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

  // Filter out owned augmentations and check rep requirements
  const potentiallyAffordable: AugmentInfo[] = []
  const unaffordable: AugmentInfo[] = []

  for (const aug of augmentMap.values()) {
    // Skip owned augmentations entirely
    if (aug.owned) continue

    // Check if we have enough rep in ANY of the factions that offer this augment
    const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)

    if (hasEnoughRep) {
      potentiallyAffordable.push(aug)
    } else {
      unaffordable.push(aug)
    }
  }

  // Topological sort optimized for minimum total cost
  // Strategy: Buy expensive augments first (to minimize 1.9x price inflation),
  // but ensure prerequisites are purchased before their dependents
  function topologicalSort(augs: AugmentInfo[]): AugmentInfo[] {
    const augsByName = new Map(augs.map((aug) => [aug.name, aug]))
    const visited = new Set<string>()
    const result: AugmentInfo[] = []

    // Build dependency graph: for each aug, track what depends on it
    const dependents = new Map<string, Set<string>>()
    const prereqCount = new Map<string, number>()

    for (const aug of augs) {
      prereqCount.set(aug.name, aug.prereqs.filter((p) => augsByName.has(p)).length)

      for (const prereqName of aug.prereqs) {
        if (augsByName.has(prereqName)) {
          if (!dependents.has(prereqName)) {
            dependents.set(prereqName, new Set())
          }
          dependents.get(prereqName)!.add(aug.name)
        }
      }
    }

    // Process augments by price (most expensive first), respecting dependencies
    while (result.length < augs.length) {
      // Find all augments with no remaining prerequisites
      const available = augs.filter((aug) => !visited.has(aug.name) && (prereqCount.get(aug.name) ?? 0) === 0)

      if (available.length === 0) break // Circular dependency or error

      // Among available augments, pick the most expensive one
      const next = available.reduce((max, aug) => (aug.price > max.price ? aug : max))

      visited.add(next.name)
      result.push(next)

      // Update prereq counts for dependents
      const deps = dependents.get(next.name)
      if (deps) {
        for (const depName of deps) {
          prereqCount.set(depName, (prereqCount.get(depName) ?? 0) - 1)
        }
      }
    }

    return result
  }

  // Sort all potentially affordable augments for optimal purchase order (expensive first, respecting prereqs)
  const optimallySorted = topologicalSort(potentiallyAffordable)

  // Now split into truly affordable (based on cumulative adjusted cost) and too expensive
  const AUGMENT_PRICE_MULT = 1.9
  let cumulativeCost = 0
  const affordable: AugmentInfo[] = []
  const tooExpensiveCumulative: AugmentInfo[] = []

  for (let i = 0; i < optimallySorted.length; i++) {
    const adjustedPrice = optimallySorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    if (cumulativeCost <= playerMoney) {
      affordable.push(optimallySorted[i])
    } else {
      // This and all subsequent augments are unaffordable due to cumulative cost
      tooExpensiveCumulative.push(...optimallySorted.slice(i))
      break
    }
  }

  // Sort unaffordable by price (most expensive first)
  unaffordable.sort((a, b) => b.price - a.price)

  return {
    affordableSorted: affordable,
    tooExpensiveCumulative,
    unaffordable,
    neuroFluxInfo,
    playerMoney,
    factionReps,
  }
}
