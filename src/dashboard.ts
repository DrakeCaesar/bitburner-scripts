import { NS } from "@ns"
import { getAugmentData } from "./libraries/augmentations.js"
import { createServerListWindow, updateServerList } from "./libraries/dashboard/serverList.js"
import { createTargetsWindow, updateTargetsView } from "./libraries/dashboard/targetAnalysis.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"
import { formatTableRow, getTableBorders } from "./libraries/tableBuilder.js"
import { createNodesWindow, updateNodesView } from "./libraries/dashboard/nodes.js"

/**
 * Unified Dashboard Script
 * Combines server list, purchased nodes, and augments views into one script
 * Reduces RAM usage by only accessing document/window once
 */
export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName()
  const hostname = ns.getHostname()
  const processes = ns.ps(hostname)

  // Kill any other instances of this script
  for (const proc of processes) {
    if (proc.filename === scriptName && proc.pid !== ns.pid) {
      ns.kill(proc.pid)
    }
  }

  // Remove existing windows if they exist
  const existingServerList = eval("document").querySelector("#server-list-window")
  if (existingServerList) existingServerList.remove()

  const existingNodes = eval("document").querySelector("#nodes-window")
  if (existingNodes) existingNodes.remove()

  const existingTargets = eval("document").querySelector("#target-analysis-window")
  if (existingTargets) existingTargets.remove()

  const existingAugments = eval("document").querySelector("#augments-window")
  if (existingAugments) existingAugments.remove()

  // Extract primary text color from game's CSS (do this once)
  const primaryElement = eval("document").querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = eval("window").getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create all four windows
  const serverListWindow = createServerListWindow(ns, primaryColor)
  const nodesWindow = createNodesWindow(ns, primaryColor)
  const targetsWindow = createTargetsWindow(ns, primaryColor)
  const augmentsWindow = createAugmentsWindow(ns, primaryColor)

  // Update loop - refresh all views every second
  while (true) {
    updateServerList(ns, serverListWindow.container, primaryColor)
    updateNodesView(ns, nodesWindow.container, primaryColor)
    updateTargetsView(ns, targetsWindow.container, primaryColor)
    updateAugmentsView(ns, augmentsWindow.container, primaryColor)
    await ns.sleep(1000)
  }
}

// ============================================================================
// AUGMENTATIONS
// ============================================================================

interface AugmentsWindow {
  window: any
  container: HTMLElement
}

function createAugmentsWindow(ns: NS, primaryColor: string): AugmentsWindow {
  const containerDiv = eval("document").createElement("div")
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  const window = new FloatingWindow({
    title: "Augmentations",
    content: containerDiv,
    width: 1000,
    height: 600,
    id: "augments-window",
    x: 1000,
    y: 700,
  })

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

function updateAugmentsView(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
  const player = ns.getPlayer()

  if (player.factions.length === 0) {
    containerDiv.textContent = "You are not in any factions yet."
    return
  }

  const { affordableSorted, tooExpensiveCumulative, unaffordable, allAugs, neuroFluxInfo, playerMoney, factionReps } =
    getAugmentData(ns, player.factions)

  // Calculate column widths
  const orderCol = "#"
  const nameCol = "Augmentation"
  const factionCol = "Faction"
  const priceCol = "Price"
  const adjustedCol = "Adj Price"
  const cumulativeCol = "Total Cost"
  const repCol = "Rep Req"
  const ownedCol = "Own"
  const statusCol = "Status"

  let orderLen = orderCol.length
  let nameLen = nameCol.length
  let factionLen = factionCol.length
  let priceLen = priceCol.length
  let adjustedLen = adjustedCol.length
  let cumulativeLen = cumulativeCol.length
  let repLen = repCol.length
  let ownedLen = ownedCol.length
  let statusLen = statusCol.length

  const AUGMENT_PRICE_MULT = 1.9
  let cumulativeCost = 0

  // Calculate column widths from all augments
  for (let i = 0; i < affordableSorted.length; i++) {
    const aug = affordableSorted[i]
    const adjustedPrice = aug.price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    orderLen = Math.max(orderLen, (i + 1).toString().length)
    nameLen = Math.max(nameLen, aug.name.length)
    factionLen = Math.max(factionLen, formatFactionText(aug.factions, 30).length)
    priceLen = Math.max(priceLen, ns.formatNumber(aug.price).length)
    adjustedLen = Math.max(adjustedLen, ns.formatNumber(adjustedPrice).length)
    cumulativeLen = Math.max(cumulativeLen, ns.formatNumber(cumulativeCost).length)
    repLen = Math.max(repLen, ns.formatNumber(aug.repReq).length)
  }

  // Build table
  const colWidths = [orderLen, nameLen, factionLen, priceLen, adjustedLen, cumulativeLen, repLen, ownedLen, statusLen]
  const borders = getTableBorders(colWidths)

  const headerCells = [
    orderCol.padStart(orderLen),
    nameCol.padEnd(nameLen),
    factionCol.padEnd(factionLen),
    priceCol.padStart(priceLen),
    adjustedCol.padStart(adjustedLen),
    cumulativeCol.padStart(cumulativeLen),
    repCol.padStart(repLen),
    ownedCol.padStart(ownedLen),
    statusCol.padStart(statusLen),
  ]

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add header
  const headerSpan = eval("document").createElement("span")
  headerSpan.textContent = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  containerDiv.appendChild(headerSpan)

  // Add affordable augments
  cumulativeCost = 0
  for (let i = 0; i < affordableSorted.length; i++) {
    const aug = affordableSorted[i]
    const adjustedPrice = aug.price * Math.pow(AUGMENT_PRICE_MULT, i)
    cumulativeCost += adjustedPrice

    const maxFactionRep = Math.max(...aug.factions.map((f) => factionReps.get(f) ?? 0))
    const canAffordMoney = cumulativeCost <= playerMoney
    const hasEnoughRep = maxFactionRep >= aug.repReq

    const rowSpan = eval("document").createElement("span")
    const order = (i + 1).toString().padStart(orderLen)
    const name = aug.name.padEnd(nameLen)
    const faction = formatFactionText(aug.factions, 30).padEnd(factionLen)

    rowSpan.textContent = `┃ ${order} ┃ ${name} ┃ ${faction} ┃ `
    containerDiv.appendChild(rowSpan)

    // Price (colored if can't afford)
    const priceSpan = eval("document").createElement("span")
    priceSpan.textContent = ns.formatNumber(aug.price).padStart(priceLen)
    if (!canAffordMoney) priceSpan.style.color = "#ff4444"
    containerDiv.appendChild(priceSpan)

    const midSpan1 = eval("document").createElement("span")
    midSpan1.textContent = " ┃ "
    containerDiv.appendChild(midSpan1)

    // Adjusted price
    const adjustedSpan = eval("document").createElement("span")
    adjustedSpan.textContent = ns.formatNumber(adjustedPrice).padStart(adjustedLen)
    if (!canAffordMoney) adjustedSpan.style.color = "#ff4444"
    containerDiv.appendChild(adjustedSpan)

    const midSpan2 = eval("document").createElement("span")
    midSpan2.textContent = " ┃ "
    containerDiv.appendChild(midSpan2)

    // Cumulative cost
    const cumulativeSpan = eval("document").createElement("span")
    cumulativeSpan.textContent = ns.formatNumber(cumulativeCost).padStart(cumulativeLen)
    if (!canAffordMoney) cumulativeSpan.style.color = "#ff4444"
    containerDiv.appendChild(cumulativeSpan)

    const midSpan3 = eval("document").createElement("span")
    midSpan3.textContent = " ┃ "
    containerDiv.appendChild(midSpan3)

    // Rep requirement
    const repSpan = eval("document").createElement("span")
    repSpan.textContent = ns.formatNumber(aug.repReq).padStart(repLen)
    if (!hasEnoughRep) repSpan.style.color = "#ff4444"
    containerDiv.appendChild(repSpan)

    const midSpan4 = eval("document").createElement("span")
    midSpan4.textContent = ` ┃ ${(aug.owned ? "Y" : " ").padStart(ownedLen)} ┃ `
    containerDiv.appendChild(midSpan4)

    // Status
    let statusSymbol = "✓"
    if (!canAffordMoney && !hasEnoughRep) statusSymbol = "XX"
    else if (!canAffordMoney) statusSymbol = "X$"
    else if (!hasEnoughRep) statusSymbol = "XR"

    const statusSpan = eval("document").createElement("span")
    statusSpan.textContent = statusSymbol.padStart(statusLen) + " ┃\n"
    containerDiv.appendChild(statusSpan)
  }

  // Add footer
  const footerSpan = eval("document").createElement("span")
  footerSpan.textContent =
    `${borders.bottom()}\n\n` +
    `Affordable: ${affordableSorted.length} | Too expensive (cumulative): ${tooExpensiveCumulative.length} | No rep: ${unaffordable.length} | Total: ${allAugs.length}\n` +
    `Current money: ${ns.formatNumber(playerMoney)}\n\n` +
    `Run: run buyAugments.js [flux]`
  containerDiv.appendChild(footerSpan)
}
