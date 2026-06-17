// ============================================================================
// AUGMENTATIONS
// ============================================================================

import { FactionName, NS } from "@ns"
import {
  AUGMENT_QUEUE_PRICE_MULT,
  filterAugmentPurchaseFactions,
  getAugmentData,
  getOwnedNeuroFluxLevel,
  isNeuroFluxAugment,
  neuroFluxIntrinsicPurchaseCost,
  neuroFluxPurchaseCost,
} from "../augmentations.js"
import { createStandardContainer, FloatingWindow } from "../floatingWindow"
import { formatTableRow, getTableBorders } from "../tableBuilder"

interface AugmentsWindow {
  window: any
  container: HTMLElement
}

export function createAugmentsWindow(
  ns: NS,
  primaryColor: string,
  position?: { x: number; y: number },
  isCollapsed?: boolean
): AugmentsWindow {
  const containerDiv = createStandardContainer(primaryColor)

  const window = new FloatingWindow({
    title: "Augmentations",
    content: containerDiv,
    id: "augments-window",
    x: position?.x ?? 1000,
    y: position?.y ?? 700,
  })
  // Toggle to collapsed state if needed
  if (isCollapsed) {
    window.toggle()
  }

  return { window, container: containerDiv }
}

function formatFactionText(factions: string[], maxWidth: number): string {
  const joined = factions.join(", ")
  if (joined.length <= maxWidth) {
    return joined
  }
  // Truncate and add ellipsis
  return joined.substring(0, maxWidth - 3) + "..."
}

function factionsMeetingRepReq(
  factions: FactionName[],
  factionReps: Map<string, number>,
  repReq: number
): FactionName[] {
  return factions.filter((f) => (factionReps.get(f) ?? 0) >= repReq)
}

function bestFactionRep(
  factions: FactionName[],
  factionReps: Map<string, number>
): { faction: FactionName; rep: number } | null {
  let best: { faction: FactionName; rep: number } | null = null
  for (const faction of factions) {
    const rep = factionReps.get(faction) ?? 0
    if (!best || rep > best.rep) {
      best = { faction, rep }
    }
  }
  return best
}

export function updateAugmentsView(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
  const player = ns.getPlayer()

  // if (player.factions.length === 0) {
  //   containerDiv.textContent = "I am not in any factions yet."
  //   return
  // }
  const factions = filterAugmentPurchaseFactions(player.factions)

  const cityFactions: string[] = ["Aevum", "Sector12", "Volhaven", "Chongqing", "Ishima", "NewTokyo"]

  const inCityFaction = factions.some((r) => cityFactions.includes(r))

  if (!inCityFaction) {
    factions.push(ns.enums.FactionName.Aevum)
    factions.push(ns.enums.FactionName.Sector12)

    factions.push(ns.enums.FactionName.Volhaven)

    factions.push(ns.enums.FactionName.Chongqing)
    factions.push(ns.enums.FactionName.Ishima)
    factions.push(ns.enums.FactionName.NewTokyo)
  }

  const { affordableSorted, tooExpensiveCumulative, unaffordable, neuroFluxInfo, playerMoney, factionReps } =
    getAugmentData(ns, factions)
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
  let priceLen = Math.max(priceCol.length, 8)
  let adjustedLen = Math.max(adjustedCol.length, 8)
  let cumulativeLen = Math.max(cumulativeCol.length, 8)
  let repLen = Math.max(repCol.length, 8)
  let ownedLen = ownedCol.length
  let statusLen = statusCol.length

  type AugmentRowKind = "buy" | "goal" | "noRep"
  interface AugmentDisplayRow {
    aug: (typeof affordableSorted)[number]
    kind: AugmentRowKind
    buyIndex?: number
  }

  // Regular augments only — NeuroFlux is always listed at the bottom, never price-sorted with these
  const displayByPrice: AugmentDisplayRow[] = [
    ...tooExpensiveCumulative
      .filter((aug) => !isNeuroFluxAugment(aug.name))
      .map((aug) => ({ aug, kind: "goal" as const })),
    ...affordableSorted
      .map((aug, buyIndex) => ({ aug, kind: "buy" as const, buyIndex }))
      .filter((row) => !isNeuroFluxAugment(row.aug.name)),
    ...unaffordable
      .filter((aug) => !isNeuroFluxAugment(aug.name))
      .map((aug) => ({ aug, kind: "noRep" as const })),
  ].sort((a, b) => b.aug.price - a.aug.price)

  const allAugs = displayByPrice.map((row) => row.aug)

  // Adjusted / cumulative columns apply only to the numbered buy plan
  const AUGMENT_PRICE_MULT = AUGMENT_QUEUE_PRICE_MULT
  let cumulativeCost = 0
  const adjustedPrices: number[] = []
  const cumulativeCosts: number[] = []

  for (let i = 0; i < affordableSorted.length; i++) {
    const adjustedPrice = affordableSorted[i].price * Math.pow(AUGMENT_PRICE_MULT, i)
    adjustedPrices.push(adjustedPrice)
    cumulativeCost += adjustedPrice
    cumulativeCosts.push(cumulativeCost)
  }

  // Pre-calculate NeuroFlux count for order column width
  const ownedNeuroFluxLevel = neuroFluxInfo ? getOwnedNeuroFluxLevel(ns) : 0
  let neuroFluxCount = 0
  if (neuroFluxInfo) {
    const lastAffordableCost = affordableSorted.length > 0 ? cumulativeCosts[affordableSorted.length - 1] : 0
    let remainingMoney = playerMoney - lastAffordableCost
    const positionOffset = affordableSorted.length
    const maxFactionRep = Math.max(...neuroFluxInfo.factions.map((f) => factionReps.get(f) ?? 0))
    let neuroFluxIndex = ownedNeuroFluxLevel

    while (true) {
      const { price, repReq } = neuroFluxPurchaseCost(ns, neuroFluxInfo, positionOffset, neuroFluxIndex)
      if (remainingMoney < price || maxFactionRep < repReq) break
      neuroFluxCount++
      neuroFluxIndex++
      remainingMoney -= price
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
    priceLen = Math.max(priceLen, ns.format.number(aug.price).length)
    repLen = Math.max(repLen, ns.format.number(aug.repReq).length)
  }

  // Update adjusted and cumulative column widths based on calculated costs
  for (let i = 0; i < adjustedPrices.length; i++) {
    adjustedLen = Math.max(adjustedLen, ns.format.number(adjustedPrices[i]).length)
    cumulativeLen = Math.max(cumulativeLen, ns.format.number(cumulativeCosts[i]).length)
  }

  if (neuroFluxInfo) {
    nameLen = Math.max(nameLen, neuroFluxInfo.name.length)
    for (let i = ownedNeuroFluxLevel; i < ownedNeuroFluxLevel + neuroFluxCount + 1; i++) {
      const { price, repReq } = neuroFluxPurchaseCost(ns, neuroFluxInfo, affordableSorted.length, i)
      const levelBasePrice = neuroFluxIntrinsicPurchaseCost(ns, neuroFluxInfo, i).price
      priceLen = Math.max(priceLen, ns.format.number(levelBasePrice).length)
      repLen = Math.max(repLen, ns.format.number(repReq).length)
      adjustedLen = Math.max(adjustedLen, ns.format.number(price).length)
    }
  }

  const colWidths = [orderLen, nameLen, factionLen, repLen, priceLen, adjustedLen, cumulativeLen, ownedLen, statusLen]
  const borders = getTableBorders(colWidths)

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

  for (const { aug, kind, buyIndex } of displayByPrice) {
    const hasEnoughMoney = playerMoney >= aug.price
    const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)
    const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
    const factionList = validFactions.length > 0 ? validFactions : aug.factions

    if (kind === "buy" && buyIndex !== undefined) {
      rows.push({
        order: (buyIndex + 1).toString().padStart(orderLen),
        name: aug.name.padEnd(nameLen),
        faction: formatFactionText(validFactions, factionLen).padEnd(factionLen),
        price: ns.format.number(aug.price).padStart(priceLen),
        priceRed: !hasEnoughMoney,
        adjusted: ns.format.number(adjustedPrices[buyIndex]).padStart(adjustedLen),
        adjustedRed: false,
        cumulative: ns.format.number(cumulativeCosts[buyIndex]).padStart(cumulativeLen),
        cumulativeRed: playerMoney < cumulativeCosts[buyIndex],
        rep: ns.format.number(aug.repReq).padStart(repLen),
        repRed: false,
        owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
        status: "Y".padStart(statusLen),
      })
      continue
    }

    let statusSymbol = ">$"
    if (kind === "noRep") {
      statusSymbol = "X"
      if (!hasEnoughMoney && !hasEnoughRep) statusSymbol = "XX"
      else if (!hasEnoughMoney) statusSymbol = "X$"
      else if (!hasEnoughRep) statusSymbol = "XR"
    }

    rows.push({
      order: " ".repeat(orderLen),
      name: aug.name.padEnd(nameLen),
      faction: formatFactionText(factionList, factionLen).padEnd(factionLen),
      price: ns.format.number(aug.price).padStart(priceLen),
      priceRed: !hasEnoughMoney,
      adjusted: " ".repeat(adjustedLen),
      adjustedRed: false,
      cumulative: " ".repeat(cumulativeLen),
      cumulativeRed: false,
      rep: ns.format.number(aug.repReq).padStart(repLen),
      repRed: kind === "noRep" && !hasEnoughRep,
      owned: (aug.owned ? "Y" : " ").padStart(ownedLen),
      status: statusSymbol.padStart(statusLen),
    })
  }

  // NeuroFlux always at the bottom (not included in price sort above)
  let neuroFluxStartIndex: number | null = null
  let orderNum = affordableSorted.length + 1
  if (neuroFluxInfo) {
    neuroFluxStartIndex = rows.length
    // Start from the money remaining after purchasing affordable regular augments only
    const lastAffordableCost = affordableSorted.length > 0 ? cumulativeCosts[affordableSorted.length - 1] : 0
    let remainingMoney = playerMoney - lastAffordableCost

    // Calculate position offset (number of affordable augments purchased affects price multiplier)
    const positionOffset = affordableSorted.length
    let neuroFluxCumulative = lastAffordableCost
    let neuroFluxIndex = ownedNeuroFluxLevel

    // Get max rep across all factions offering NeuroFlux
    const maxFactionRep = Math.max(...neuroFluxInfo.factions.map((f) => factionReps.get(f) ?? 0))

    // Create a row for each NeuroFlux purchase we can afford
    while (true) {
      const { price: currentPrice, repReq: currentRepReq } = neuroFluxPurchaseCost(
        ns,
        neuroFluxInfo,
        positionOffset,
        neuroFluxIndex
      )
      if (remainingMoney < currentPrice || maxFactionRep < currentRepReq) break

      neuroFluxCumulative += currentPrice
      const levelBasePrice = neuroFluxIntrinsicPurchaseCost(ns, neuroFluxInfo, neuroFluxIndex).price

      const nfFactionsAtLevel = factionsMeetingRepReq(neuroFluxInfo.factions, factionReps, currentRepReq)

      rows.push({
        order: orderNum.toString().padStart(orderLen),
        name: neuroFluxInfo.name.padEnd(nameLen),
        faction: formatFactionText(nfFactionsAtLevel, factionLen).padEnd(factionLen),
        price: ns.format.number(levelBasePrice).padStart(priceLen),
        priceRed: playerMoney < levelBasePrice,
        adjusted: ns.format.number(currentPrice).padStart(adjustedLen),
        adjustedRed: false,
        cumulative: ns.format.number(neuroFluxCumulative).padStart(cumulativeLen),
        cumulativeRed: false,
        rep: ns.format.number(currentRepReq).padStart(repLen),
        repRed: false,
        owned: (neuroFluxInfo.owned ? "Y" : " ").padStart(ownedLen),
        status: "~".padStart(statusLen),
      })

      remainingMoney -= currentPrice
      neuroFluxIndex++
      orderNum++
    }

    // Next NeuroFlux level we cannot buy yet (first if none affordable, otherwise one past last affordable)
    const { price: nextPrice, repReq: nextRepReq } = neuroFluxPurchaseCost(
      ns,
      neuroFluxInfo,
      positionOffset,
      neuroFluxIndex
    )
    const nextCumulative = neuroFluxCumulative + nextPrice
    const levelBasePrice = neuroFluxIntrinsicPurchaseCost(ns, neuroFluxInfo, neuroFluxIndex).price
    const canAffordMoney = remainingMoney >= nextPrice
    const hasEnoughRep = maxFactionRep >= nextRepReq

    let statusSymbol = "X"
    if (!canAffordMoney && !hasEnoughRep) statusSymbol = "XX"
    else if (!canAffordMoney) statusSymbol = "X$"
    else if (!hasEnoughRep) statusSymbol = "XR"

    const nfFactionsAtLevel = factionsMeetingRepReq(neuroFluxInfo.factions, factionReps, nextRepReq)

    rows.push({
      order: " ".repeat(orderLen),
      name: neuroFluxInfo.name.padEnd(nameLen),
      faction: formatFactionText(
        nfFactionsAtLevel.length > 0 ? nfFactionsAtLevel : neuroFluxInfo.factions,
        factionLen
      ).padEnd(factionLen),
      price: ns.format.number(levelBasePrice).padStart(priceLen),
      priceRed: !canAffordMoney,
      adjusted: ns.format.number(nextPrice).padStart(adjustedLen),
      adjustedRed: !canAffordMoney,
      cumulative: ns.format.number(nextCumulative).padStart(cumulativeLen),
      cumulativeRed: true,
      rep: ns.format.number(nextRepReq).padStart(repLen),
      repRed: !hasEnoughRep,
      owned: (neuroFluxInfo.owned ? "Y" : " ").padStart(ownedLen),
      status: statusSymbol.padStart(statusLen),
    })
  }

  const headerCells = [
    orderCol.padStart(orderLen),
    nameCol.padEnd(nameLen),
    factionCol.padEnd(factionLen),
    repCol.padStart(repLen),
    priceCol.padStart(priceLen),
    adjustedCol.padStart(adjustedLen),
    cumulativeCol.padStart(cumulativeLen),
    ownedCol.padStart(ownedLen),
    statusCol.padStart(statusLen),
  ]

  const tableHeader = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  let neuroFluxRepNote = ""
  if (neuroFluxInfo) {
    const best = bestFactionRep(neuroFluxInfo.factions, factionReps)
    if (best) {
      neuroFluxRepNote = `\nNeuroFlux rep check uses best faction: ${best.faction} (${ns.format.number(best.rep)})`
    }
  }

  const tableFooter =
    `${borders.bottom()}\n` +
    `\nRegular augments by base price | NeuroFlux at bottom | Buying: ${affordableSorted.length} | Goals: ${tooExpensiveCumulative.length} | No rep: ${unaffordable.length}\n` +
    `Current money: ${ns.format.number(playerMoney)}${neuroFluxRepNote}`

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add header
  const headerSpan = document.createElement("span")
  headerSpan.textContent = tableHeader
  containerDiv.appendChild(headerSpan)

  // Add rows with conditional coloring
  for (let i = 0; i < rows.length; i++) {
    if (neuroFluxStartIndex !== null && i === neuroFluxStartIndex) {
      const sepSpan = document.createElement("span")
      sepSpan.textContent = `${borders.separator()}\n`
      containerDiv.appendChild(sepSpan)
    }

    const row = rows[i]
    const rowSpan = document.createElement("span")
    rowSpan.textContent = `┃ ${row.order} ┃ ${row.name} ┃ ${row.faction} ┃ `
    containerDiv.appendChild(rowSpan)

    // Rep requirement column (moved before price)
    const repSpan = document.createElement("span")
    repSpan.textContent = row.rep
    if (row.repRed) repSpan.style.color = "rgb(195, 45, 45)"
    containerDiv.appendChild(repSpan)

    const midSpan1 = document.createElement("span")
    midSpan1.textContent = " ┃ "
    containerDiv.appendChild(midSpan1)

    // Price column - green if affordable, red if unaffordable
    const priceSpan = document.createElement("span")
    priceSpan.textContent = row.price
    if (row.priceRed) {
      priceSpan.style.color = "rgb(195, 45, 45)"
    } else {
      priceSpan.style.color = "rgb(100, 214, 100)"
    }
    containerDiv.appendChild(priceSpan)

    const midSpan2 = document.createElement("span")
    midSpan2.textContent = " ┃ "
    containerDiv.appendChild(midSpan2)

    const adjustedSpan = document.createElement("span")
    adjustedSpan.textContent = row.adjusted
    if (row.adjustedRed) adjustedSpan.style.color = "rgb(195, 45, 45)"
    containerDiv.appendChild(adjustedSpan)

    const midSpan3 = document.createElement("span")
    midSpan3.textContent = " ┃ "
    containerDiv.appendChild(midSpan3)

    const cumulativeSpan = document.createElement("span")
    cumulativeSpan.textContent = row.cumulative
    if (row.cumulativeRed) cumulativeSpan.style.color = "rgb(195, 45, 45)"
    containerDiv.appendChild(cumulativeSpan)

    const endSpan = document.createElement("span")
    endSpan.textContent = ` ┃ ${row.owned} ┃ ${row.status} ┃\n`
    containerDiv.appendChild(endSpan)
  }

  // Add footer
  const footerSpan = document.createElement("span")
  footerSpan.textContent = tableFooter
  containerDiv.appendChild(footerSpan)
}
