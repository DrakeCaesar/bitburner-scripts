import { NS } from "@ns"
import { FloatingWindow } from "../floatingWindow"
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

export function createNodesWindow(ns: NS, primaryColor: string): NodesWindow {
  const containerDiv = eval("document").createElement("div")
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  const window = new FloatingWindow({
    title: "Purchased Servers",
    content: containerDiv,
    width: 600,
    height: 700,
    id: "nodes-window",
    x: 900,
    y: 50,
  })

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

  const totalChars = 20

  if (ram === 0) {
    // All empty
    return EMPTY_LEFT + EMPTY_CENTER.repeat(totalChars - 2) + EMPTY_RIGHT
  }

  // Calculate how many doublings from 1 to maxRam
  const maxDoublings = Math.log2(maxRam)
  // Calculate current doublings from 1 to ram
  const currentDoublings = Math.log2(ram)

  // Calculate bars (filled)
  const bars = Math.floor((currentDoublings / maxDoublings) * totalChars)

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
  const maxRam = ns.getPurchasedServerMaxRam()
  const nodes: NodeInfo[] = []

  // Collect all node information
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    const exists = ns.serverExists(nodeName)
    const ram = exists ? ns.getServerMaxRam(nodeName) : 0

    nodes.push({
      name: nodeName,
      exists,
      ram,
      ramFormatted: exists ? ns.formatRam(ram) : "-",
      progressBar: generateProgressBar(ram, maxRam),
    })
  }

  // Calculate stats
  const existingNodes = nodes.filter((n) => n.exists)
  const totalRam = existingNodes.reduce((sum, n) => sum + n.ram, 0)
  const avgRam = existingNodes.length > 0 ? totalRam / existingNodes.length : 0
  const minRam = existingNodes.length > 0 ? Math.min(...existingNodes.map((n) => n.ram)) : 0
  const maxNodeRam = existingNodes.length > 0 ? Math.max(...existingNodes.map((n) => n.ram)) : 0

  // Calculate target RAM and cost
  const money = ns.getPlayer().money
  const bestRam = existingNodes.length > 0 ? Math.max(...existingNodes.map((n) => n.ram)) : 0

  // Target is always double the best (or 1 if no servers), capped at maxRam
  const targetRam = bestRam > 0 ? Math.min(bestRam * 2, maxRam) : 1
  const cost = ns.getPurchasedServerCost(targetRam)

  // Determine next action
  let nextAction = "Save money"
  let savingsInfo = ""

  if (bestRam >= maxRam) {
    nextAction = `All servers maxed at ${ns.formatRam(maxRam)}`
    savingsInfo = `Max server RAM reached (${ns.formatRam(maxRam)}) - Cost to purchase: ${ns.formatNumber(cost)}`
  } else if (money >= cost) {
    if (existingNodes.length < 25) {
      nextAction = `Buy ${ns.formatRam(targetRam)} server (${ns.formatNumber(cost)})`
    } else {
      const worstNode = existingNodes.reduce((min, n) => (n.ram < min.ram ? n : min))
      nextAction = `Upgrade ${worstNode.name} to ${ns.formatRam(targetRam)} (${ns.formatNumber(cost)})`
    }
    savingsInfo = `Ready to purchase!`
  } else {
    const needed = cost - money
    const percentSaved = (money / cost) * 100

    if (existingNodes.length < 25) {
      nextAction = `Save for ${ns.formatRam(targetRam)} server`
    } else {
      const worstNode = existingNodes.reduce((min, n) => (n.ram < min.ram ? n : min))
      nextAction = `Save to upgrade ${worstNode.name} to ${ns.formatRam(targetRam)}`
    }
    savingsInfo = `Saving: ${ns.formatNumber(money)} / ${ns.formatNumber(cost)} (${percentSaved.toFixed(1)}%) - Need ${ns.formatNumber(needed)} more`
  }

  // Calculate column widths
  const nameCol = "Node"
  const ramCol = "RAM"
  const progressCol = "Progress"

  let nameLen = nameCol.length
  let ramLen = ramCol.length
  const progressLen = 20 // Fixed width for progress bar

  for (const node of nodes) {
    nameLen = Math.max(nameLen, node.name.length)
    ramLen = Math.max(ramLen, node.ramFormatted.length)
  }

  // Build table
  const colWidths = [nameLen, ramLen, progressLen]
  const borders = getTableBorders(colWidths)

  const headerCells = [nameCol.padEnd(nameLen), ramCol.padEnd(ramLen), progressCol.padEnd(progressLen)]

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add header
  const headerSpan = eval("document").createElement("span")
  headerSpan.textContent = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  containerDiv.appendChild(headerSpan)

  // Add rows
  for (const node of nodes) {
    const status = node.exists ? "✓" : " "
    const rowSpan = eval("document").createElement("span")
    rowSpan.textContent = formatTableRow([
      node.name.padEnd(nameLen),
      node.ramFormatted.padEnd(ramLen),
      node.progressBar.padEnd(progressLen),
    ])
    rowSpan.textContent += "\n"
    containerDiv.appendChild(rowSpan)
  }

  // Add footer
  const footerSpan = eval("document").createElement("span")
  footerSpan.textContent =
    `${borders.bottom()}\n` +
    `\nServers: ${existingNodes.length}/25 | Total RAM: ${ns.formatRam(totalRam)} | Avg: ${ns.formatRam(avgRam)}\n` +
    `Min: ${ns.formatRam(minRam)} | Max: ${ns.formatRam(maxNodeRam)} | System Max: ${ns.formatRam(maxRam)}\n` +
    `Next: ${nextAction}\n` +
    `${savingsInfo}`
  containerDiv.appendChild(footerSpan)
}
