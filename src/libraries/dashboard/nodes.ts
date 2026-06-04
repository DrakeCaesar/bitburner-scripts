import { NS } from "@ns"
import { createStandardContainer, FloatingWindow } from "../floatingWindow"
import { formatTableRow, getTableBorders } from "../tableBuilder"

interface NodesWindow {
  window: any
  container: HTMLElement
}

interface NodeInfo {
  name: string
  exists: boolean
  ram: number
  ramFormatted: string
  progressBar: string
}

/** Hacknet-server RAM cap (GB); progress bars always use this scale, not best-owned. */
const HACKNET_SERVER_MAX_RAM_GB = 8192

export function createNodesWindow(
  ns: NS,
  primaryColor: string,
  position?: { x: number; y: number },
  isCollapsed?: boolean
): NodesWindow {
  const containerDiv = createStandardContainer(primaryColor)

  const window = new FloatingWindow({
    title: "Purchased Servers",
    content: containerDiv,
    id: "nodes-window",
    x: position?.x ?? 900,
    y: position?.y ?? 50,
  })

  // Toggle to collapsed state if needed
  if (isCollapsed) {
    window.toggle()
  }

  return { window, container: containerDiv }
}

function generateProgressBar(ram: number, maxRam: number): string {
  // Progress bar characters
  const FILLED_LEFT = ""
  const FILLED_CENTER = ""
  const FILLED_RIGHT = ""
  const EMPTY_LEFT = ""
  const EMPTY_CENTER = ""
  const EMPTY_RIGHT = ""

  const totalChars = Math.log2(maxRam) + 1

  if (ram === 0) {
    // All empty
    return EMPTY_LEFT + EMPTY_CENTER.repeat(totalChars - 2) + EMPTY_RIGHT
  }

  const bars = Math.log2(ram) + 1

  // Build the progress bar
  let result = ""

  for (let i = 0; i < totalChars; i++) {
    if (i === 0) {
      result += i < bars ? FILLED_LEFT : EMPTY_LEFT
    } else if (i === totalChars - 1) {
      result += i < bars ? FILLED_RIGHT : EMPTY_RIGHT
    } else {
      result += i < bars ? FILLED_CENTER : EMPTY_CENTER
    }
  }

  return result
}

function generateLinearProgressBar(value: number, maxValue: number): string {
  // Progress bar characters for linear (non-logarithmic) progress
  const FILLED_LEFT = ""
  const FILLED_CENTER = ""
  const FILLED_RIGHT = ""
  const EMPTY_LEFT = ""
  const EMPTY_CENTER = ""
  const EMPTY_RIGHT = ""

  const totalChars = maxValue

  if (value === 0) {
    // All empty
    return EMPTY_LEFT + EMPTY_CENTER.repeat(totalChars - 2) + EMPTY_RIGHT
  }

  const bars = value

  // Build the progress bar
  let result = ""

  for (let i = 0; i < totalChars; i++) {
    if (i === 0) {
      result += i < bars ? FILLED_LEFT : EMPTY_LEFT
    } else if (i === totalChars - 1) {
      result += i < bars ? FILLED_RIGHT : EMPTY_RIGHT
    } else {
      result += i < bars ? FILLED_CENTER : EMPTY_CENTER
    }
  }

  return result
}

export function updateNodesView(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
  const resetInfo = ns.getResetInfo()
  const useHacknet =
    !resetInfo.bitNodeOptions.disableHacknetServer &&
    (resetInfo.currentNode === 9 || (resetInfo.ownedSF.get(9) ?? 0) >= 1)

  const minHomeRam = 8
  const maxHomeRam = Math.pow(2, 30)
  const maxHomeCores = 8 // Maximum cores for home server

  const nodes: NodeInfo[] = []
  const digits = 3

  const homeRam = ns.getServerMaxRam("home")
  const homeCores = ns.getServer("home").cpuCores

  let maxPurchasableRam: number
  let barScaleMaxRam: number
  let nextAction: string
  let savingsInfo: string

  if (useHacknet) {
    const maxNodes = ns.hacknet.maxNumNodes()
    const numNodes = ns.hacknet.numNodes()
    maxPurchasableRam = HACKNET_SERVER_MAX_RAM_GB
    barScaleMaxRam = HACKNET_SERVER_MAX_RAM_GB

    for (let i = 0; i < maxNodes; i++) {
      const nodeName = `hacknet-server-${i}`
      const exists = i < numNodes
      const ram = exists ? ns.hacknet.getNodeStats(i).ram : 0

      nodes.push({
        name: nodeName,
        exists,
        ram,
        ramFormatted: exists ? ns.format.ram(ram, digits) : "-",
        progressBar: generateProgressBar(ram, barScaleMaxRam),
      })
    }

    const money = ns.getPlayer().money
    const hashes = ns.hacknet.numHashes()
    const hashCapacity = ns.hacknet.hashCapacity()
    nextAction = "Save money"
    savingsInfo = `Hashes: ${ns.format.number(hashes)} / ${ns.format.number(hashCapacity)}`

    if (numNodes < maxNodes) {
      const cost = ns.hacknet.getPurchaseNodeCost()
      if (money >= cost) {
        nextAction = `Buy hacknet-server-${numNodes} (${ns.format.number(cost)})`
        savingsInfo += " | Ready to purchase!"
      } else {
        nextAction = `Saving for hacknet-server-${numNodes}`
        savingsInfo += ` | ${ns.format.number(money)} / ${ns.format.number(cost)} (${((money / cost) * 100).toFixed(1)}%)`
      }
    } else {
      nextAction = `All ${maxNodes} hacknet servers owned`
    }
  } else {
    maxPurchasableRam = ns.cloud.getRamLimit()
    barScaleMaxRam = maxPurchasableRam

    for (let i = 0; i < 25; i++) {
      const nodeName = "node" + String(i).padStart(2, "0")
      const exists = ns.serverExists(nodeName)
      const ram = exists ? ns.getServerMaxRam(nodeName) : 0

      nodes.push({
        name: nodeName,
        exists,
        ram,
        ramFormatted: exists ? ns.format.ram(ram, digits) : "-",
        progressBar: generateProgressBar(ram, barScaleMaxRam),
      })
    }

    const existingNodes = nodes.filter((n) => n.exists)
    const money = ns.getPlayer().money
    const bestRam = existingNodes.length > 0 ? Math.max(...existingNodes.map((n) => n.ram)) : 0
    const targetRam = bestRam > 0 ? Math.min(bestRam * 2, maxPurchasableRam) : 1
    const cost = ns.cloud.getServerCost(targetRam)

    nextAction = "Save money"
    savingsInfo = ""

    if (bestRam >= maxPurchasableRam) {
      nextAction = `All servers maxed at ${ns.format.ram(maxPurchasableRam, digits)}`
      savingsInfo = `Max server RAM reached (${ns.format.ram(maxPurchasableRam, digits)}) - Cost to purchase: ${ns.format.number(cost)}`
    } else if (money >= cost) {
      if (existingNodes.length < 25) {
        nextAction = `Buy ${ns.format.ram(targetRam, digits)} server (${ns.format.number(cost)})`
      } else {
        const worstNode = existingNodes.reduce((min, n) => (n.ram < min.ram ? n : min))
        nextAction = `Upgrade ${worstNode.name} to ${ns.format.ram(targetRam, digits)} (${ns.format.number(cost, digits)})`
      }
      savingsInfo = `Ready to purchase!`
    } else {
      const needed = cost - money
      const percentSaved = (money / cost) * 100

      if (existingNodes.length < 25) {
        nextAction = `Saving for ${ns.format.ram(targetRam, digits)} server`
      } else {
        const worstNode = existingNodes.reduce((min, n) => (n.ram < min.ram ? n : min))
        nextAction = `Save to upgrade ${worstNode.name} to ${ns.format.ram(targetRam, digits)}`
      }
      savingsInfo = `${ns.format.number(money)} / ${ns.format.number(cost)} (${percentSaved.toFixed(1)}%) - ${ns.format.number(needed)}`
    }
  }

  // Calculate column widths - using 2 columns: Node+Progress merged, and Value
  // Calculate the length needed for node name + progress bar
  const ramProgressLen = Math.log2(barScaleMaxRam) + 1
  const homeRamProgressLen = Math.log2(maxHomeRam / minHomeRam) + 1 // This is the longest progress bar

  // Node column width is the max of node names
  let maxNodeNameLen = 0
  for (const node of nodes) {
    maxNodeNameLen = Math.max(maxNodeNameLen, node.name.length)
  }

  // Combined column: use home RAM progress length as it's the longest
  // For purchased servers: node name + space + progress bar
  // For home rows: just the progress bar (which can be longer)
  const nodeProgressLen = Math.max(
    maxNodeNameLen + 1 + ramProgressLen, // Purchased server format: "node00 ████"
    homeRamProgressLen // Home format: just the long progress bar
  )

  // Value column width
  let valueLen = 0
  valueLen = Math.max(valueLen, ns.format.ram(homeRam, digits).length, homeCores.toString().length)
  for (const node of nodes) {
    valueLen = Math.max(valueLen, node.ramFormatted.length)
  }

  const ownedNodes = nodes.filter((n) => n.exists)
  const totalRam = ownedNodes.reduce((sum, n) => sum + n.ram, 0)
  const totalRamFormatted = ns.format.ram(totalRam, digits)
  const totalLabel = useHacknet
    ? `Total (${ownedNodes.length}/${nodes.length})`
    : `Total (${ownedNodes.length})`
  valueLen = Math.max(valueLen, totalRamFormatted.length)
  const nodeProgressLenWithTotal = Math.max(nodeProgressLen, totalLabel.length)

  // Build table with 2 columns
  const colWidths = [nodeProgressLenWithTotal, valueLen]
  const borders = getTableBorders(colWidths)

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add top border only (no header)
  const topBorderSpan = document.createElement("span")
  topBorderSpan.textContent = `${borders.top()}\n`
  containerDiv.appendChild(topBorderSpan)

  // Add home server rows (without "home" label to save space)
  const homeSpan = document.createElement("span")
  const homeRamProgressBar = generateProgressBar(homeRam / minHomeRam, maxHomeRam / minHomeRam)
  const homeCoresProgressBar = generateLinearProgressBar(homeCores, maxHomeCores)
  homeSpan.textContent =
    formatTableRow([
      homeRamProgressBar.padStart(colWidths[0]), // Right-align to end of column
      ns.format.ram(homeRam, digits).padStart(valueLen), // Right-align value
    ]) +
    "\n" +
    formatTableRow([
      homeCoresProgressBar.padStart(colWidths[0]), // Right-align to end of column
      (homeCores.toString() + (homeCores == 1 ? " Core " : " Cores")).padStart(valueLen), // Right-align value
    ]) +
    "\n" +
    borders.header() +
    "\n"
  containerDiv.appendChild(homeSpan)

  const totalSpan = document.createElement("span")
  totalSpan.textContent =
    formatTableRow([totalLabel.padStart(colWidths[0]), totalRamFormatted.padStart(valueLen)]) + "\n"
  containerDiv.appendChild(totalSpan)

  // Add purchased server rows
  for (const node of nodes) {
    const rowSpan = document.createElement("span")
    // Format: "node00 ████████" with padding before progress bar to right-align with home bars
    const nodeAndProgress = `${node.name} ${node.progressBar}`.padStart(colWidths[0])
    rowSpan.textContent = formatTableRow([
      nodeAndProgress,
      node.ramFormatted.padStart(valueLen), // Right-align value
    ])
    rowSpan.textContent += "\n"
    containerDiv.appendChild(rowSpan)
  }

  // Add footer
  const footerSpan = document.createElement("span")
  footerSpan.textContent =
    `${borders.bottom()}\n` +
    `${nextAction}\n` +
    `${savingsInfo}`
  containerDiv.appendChild(footerSpan)
}
