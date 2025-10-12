import { NS } from "@ns"
import { analyzeAllServers } from "../findBestTarget"
import { FloatingWindow } from "../floatingWindow"
import { getNodesForBatching } from "../serverManagement"
import { formatTableRow, getTableBorders } from "../tableBuilder"

interface TargetsWindow {
  window: any
  container: HTMLElement
}

export function createTargetsWindow(ns: NS, primaryColor: string): TargetsWindow {
  const containerDiv = document.createElement("div")
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  const window = new FloatingWindow({
    title: "Target Analysis",
    content: containerDiv,
    id: "target-analysis-window",
    x: 50,
    y: 700,
  })

  return { window, container: containerDiv }
}

export async function updateTargetsView(ns: NS, containerDiv: HTMLElement, primaryColor: string): Promise<void> {
  // Get nodes for batching
  const nodes = getNodesForBatching(ns)

  if (nodes.length === 0) {
    containerDiv.textContent = "ERROR: No nodes with root access found"
    return
  }

  const totalMaxRam = nodes.reduce((sum: number, node: string) => {
    if (node === "home") {
      return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
    }
    return sum + ns.getServerMaxRam(node)
  }, 0)

  const nodeRamLimit = Math.min(...nodes.map((node: string) => ns.getServerMaxRam(node)))
  const myCores = ns.getServer(nodes[0]).cpuCores
  const batchDelay = 50
  const batchCycles = 3

  // Analyze servers
  const profitabilityData = await analyzeAllServers(
    ns,
    totalMaxRam,
    nodeRamLimit,
    myCores,
    batchDelay,
    nodes,
    undefined,
    batchCycles
  )

  // Take top 20 servers only for display
  const topServers = profitabilityData.slice(0, 20)

  // Calculate column widths
  const serverCol = "Server"
  const lvlCol = "Level"
  const moneyCol = "Max Money"
  const timeCol = "Weaken Time"
  const thresholdCol = "Threshold"
  const incomeCol = "$/sec"
  const ramCol = "Batch RAM"
  const batchesCol = "Batches"

  let serverLen = serverCol.length
  let lvlLen = lvlCol.length
  let moneyLen = moneyCol.length
  let timeLen = timeCol.length
  let thresholdLen = thresholdCol.length
  let incomeLen = incomeCol.length
  let ramLen = ramCol.length
  let batchesLen = batchesCol.length

  for (const data of topServers) {
    serverLen = Math.max(serverLen, data.serverName.length)
    lvlLen = Math.max(lvlLen, data.hackLevel.toString().length)
    moneyLen = Math.max(moneyLen, ns.formatNumber(data.moneyMax).length)
    timeLen = Math.max(timeLen, ns.tFormat(data.weakenTime).length)
    thresholdLen = Math.max(thresholdLen, `${(data.optimalThreshold * 100).toFixed(1)}%`.length)
    incomeLen = Math.max(incomeLen, ns.formatNumber(data.moneyPerSecond).length)
    ramLen = Math.max(ramLen, ns.formatRam(data.batchRam).length)
    batchesLen = Math.max(batchesLen, data.batches.toString().length)
  }

  // Build table
  const colWidths = [serverLen, lvlLen, moneyLen, timeLen, thresholdLen, incomeLen, ramLen, batchesLen]
  const borders = getTableBorders(colWidths)

  const headerCells = [
    serverCol.padEnd(serverLen),
    lvlCol.padStart(lvlLen),
    moneyCol.padStart(moneyLen),
    timeCol.padStart(timeLen),
    thresholdCol.padStart(thresholdLen),
    incomeCol.padStart(incomeLen),
    ramCol.padStart(ramLen),
    batchesCol.padStart(batchesLen),
  ]

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add header
  const headerSpan = document.createElement("span")
  headerSpan.textContent = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  containerDiv.appendChild(headerSpan)

  // Add rows
  for (const data of topServers) {
    const rowSpan = document.createElement("span")
    rowSpan.textContent = formatTableRow([
      data.serverName.padEnd(serverLen),
      data.hackLevel.toString().padStart(lvlLen),
      ns.formatNumber(data.moneyMax).padStart(moneyLen),
      ns.tFormat(data.weakenTime).padStart(timeLen),
      `${(data.optimalThreshold * 100).toFixed(1)}%`.padStart(thresholdLen),
      ns.formatNumber(data.moneyPerSecond).padStart(incomeLen),
      ns.formatRam(data.batchRam).padStart(ramLen),
      data.batches.toString().padStart(batchesLen),
    ])
    rowSpan.textContent += "\n"
    containerDiv.appendChild(rowSpan)
  }

  // Add footer
  const footerSpan = document.createElement("span")
  footerSpan.textContent = `${borders.bottom()}\n\nShowing top 20 of ${profitabilityData.length} servers | Total RAM: ${ns.formatRam(totalMaxRam)}`
  containerDiv.appendChild(footerSpan)
}
