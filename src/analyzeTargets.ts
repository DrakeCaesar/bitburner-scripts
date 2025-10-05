import { NS } from "@ns"
import { analyzeAllServers } from "./findBestTarget.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined
  const includePrepTime: Boolean = ns.args[1] === "true"

  // Remove existing window if it exists
  const existingWindow = eval("document").querySelector("#target-analysis-window")
  if (existingWindow) {
    existingWindow.remove()
  }

  // Get nodes for batching (same logic as batch.ts)
  const nodes = getNodesForBatching(ns)

  if (nodes.length === 0) {
    ns.tprint("ERROR: No nodes with root access found")
    return
  }

  const totalMaxRam = nodes.reduce((sum: number, node: string) => {
    if (node === "home") {
      return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
    }
    return sum + ns.getServerMaxRam(node)
  }, 0)
  const minNodeRam = Math.min(...nodes.map((node: string) => ns.getServerMaxRam(node)))
  const myCores = ns.getServer(nodes[0]).cpuCores
  const batchDelay = 50

  // Use the imported function to analyze servers
  const profitabilityData = analyzeAllServers(ns, totalMaxRam, minNodeRam, myCores, batchDelay, playerHackLevel, includePrepTime)

  // Column headers
  const serverCol = "Server"
  const lvlCol = "Level"
  const moneyCol = "Max Money"
  const timeCol = "Weaken Time"
  const thresholdCol = "Threshold"
  const incomeCol = "$/sec"
  const ramCol = "Batch RAM"
  const batchesCol = "Batches"

  // Calculate column widths
  let serverLen = serverCol.length
  let lvlLen = lvlCol.length
  let moneyLen = moneyCol.length
  let timeLen = timeCol.length
  let thresholdLen = thresholdCol.length
  let incomeLen = incomeCol.length
  let ramLen = ramCol.length
  let batchesLen = batchesCol.length

  for (const data of profitabilityData) {
    serverLen = Math.max(serverLen, data.serverName.length)
    lvlLen = Math.max(lvlLen, data.hackLevel.toString().length)
    moneyLen = Math.max(moneyLen, ns.formatNumber(data.moneyMax).length)
    timeLen = Math.max(timeLen, ns.tFormat(data.weakenTime).length)
    thresholdLen = Math.max(thresholdLen, `${(data.optimalThreshold * 100).toFixed(1)}%`.length)
    incomeLen = Math.max(incomeLen, ns.formatNumber(data.moneyPerSecond).length)
    ramLen = Math.max(ramLen, ns.formatRam(data.batchRam).length)
    batchesLen = Math.max(batchesLen, data.batches.toString().length)
  }

  // Build table with box-drawing characters
  let tableRows = ""
  for (const data of profitabilityData) {
    const server = data.serverName.padEnd(serverLen)
    const lvl = data.hackLevel.toString().padStart(lvlLen)
    const money = ns.formatNumber(data.moneyMax).padStart(moneyLen)
    const time = ns.tFormat(data.weakenTime).padStart(timeLen)
    const threshold = `${(data.optimalThreshold * 100).toFixed(1)}%`.padStart(thresholdLen)
    const income = ns.formatNumber(data.moneyPerSecond).padStart(incomeLen)
    const ram = ns.formatRam(data.batchRam).padStart(ramLen)
    const batches = data.batches.toString().padStart(batchesLen)

    tableRows += `┃ ${server} ┃ ${lvl} ┃ ${money} ┃ ${time} ┃ ${threshold} ┃ ${income} ┃ ${ram} ┃ ${batches} ┃\n`
  }

  const fullTable =
    `┏━${"━".repeat(serverLen)}━┳━${"━".repeat(lvlLen)}━┳━${"━".repeat(moneyLen)}━┳━${"━".repeat(timeLen)}━┳━${"━".repeat(thresholdLen)}━┳━${"━".repeat(incomeLen)}━┳━${"━".repeat(ramLen)}━┳━${"━".repeat(batchesLen)}━┓\n` +
    `┃ ${serverCol.padEnd(serverLen)} ┃ ${lvlCol.padStart(lvlLen)} ┃ ${moneyCol.padStart(moneyLen)} ┃ ${timeCol.padStart(timeLen)} ┃ ${thresholdCol.padStart(thresholdLen)} ┃ ${incomeCol.padStart(incomeLen)} ┃ ${ramCol.padStart(ramLen)} ┃ ${batchesCol.padStart(batchesLen)} ┃\n` +
    `┣━${"━".repeat(serverLen)}━╋━${"━".repeat(lvlLen)}━╋━${"━".repeat(moneyLen)}━╋━${"━".repeat(timeLen)}━╋━${"━".repeat(thresholdLen)}━╋━${"━".repeat(incomeLen)}━╋━${"━".repeat(ramLen)}━╋━${"━".repeat(batchesLen)}━┫\n` +
    `${tableRows}` +
    `┗━${"━".repeat(serverLen)}━┻━${"━".repeat(lvlLen)}━┻━${"━".repeat(moneyLen)}━┻━${"━".repeat(timeLen)}━┻━${"━".repeat(thresholdLen)}━┻━${"━".repeat(incomeLen)}━┻━${"━".repeat(ramLen)}━┻━${"━".repeat(batchesLen)}━┛`

  // Extract primary text color from game's CSS
  const primaryElement = eval("document").querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = eval("window").getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create pre element for monospace formatting
  const pre = eval("document").createElement("pre")
  pre.style.margin = "0"
  pre.style.fontFamily = "monospace"
  pre.style.fontSize = "12px"
  pre.style.whiteSpace = "pre"
  pre.style.lineHeight = "1.2"
  pre.style.color = primaryColor
  pre.style.overflow = "auto"
  pre.textContent = fullTable

  // Calculate content width based on longest line (approximate)
  const lines = fullTable.split("\n")
  const maxLineLength = Math.max(...lines.map((line) => line.length))
  // Approximate character width: 7.2px per character for 12px monospace font
  const contentWidth = Math.min(maxLineLength * 7.2 + 40, eval("window").innerWidth - 100)

  // Create floating window
  new FloatingWindow({
    title: `Target Profitability Analysis (${profitabilityData.length} servers, ${ns.formatRam(totalMaxRam)} RAM)`,
    content: pre,
    width: contentWidth,
    height: 600,
    id: "target-analysis-window",
  })
}
