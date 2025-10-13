import { NS } from "@ns"
import { analyzeAllServers } from "./libraries/findBestTarget.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"
import { buildTable } from "./libraries/tableBuilder.js"
import { getEffectiveMaxRam } from "./libraries/ramUtils.js"

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined
  const batchCycles = ns.args[1] ? Number(ns.args[1]) : 3

  // Remove existing window if it exists
  const existingWindow = document.querySelector("#target-analysis-window")
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
      return sum + (getEffectiveMaxRam(ns, node) - ns.getServerUsedRam(node))
    }
    return sum + getEffectiveMaxRam(ns, node)
  }, 0)
  const nodeRamLimit = Math.min(...nodes.map((node: string) => getEffectiveMaxRam(ns, node)))
  const myCores = ns.getServer(nodes[0]).cpuCores
  const batchDelay = 50

  // Use the imported function to analyze servers
  const profitabilityData = await analyzeAllServers(
    ns,
    totalMaxRam,
    nodeRamLimit,
    myCores,
    batchDelay,
    nodes,
    playerHackLevel,
    batchCycles
  )

  // Build table using the table builder library
  const fullTable = buildTable({
    columns: [
      { header: "Server", align: "left" },
      { header: "Level", align: "right" },
      { header: "Max Money", align: "right" },
      { header: "Weaken Time", align: "right" },
      { header: "Threshold", align: "right" },
      { header: "$/sec", align: "right" },
      { header: "Batch RAM", align: "right" },
      { header: "Batches", align: "right" },
    ],
    rows: profitabilityData.map((data) => [
      data.serverName,
      data.hackLevel.toString(),
      ns.formatNumber(data.moneyMax),
      ns.tFormat(data.weakenTime),
      `${(data.optimalThreshold * 100).toFixed(1)}%`,
      ns.formatNumber(data.moneyPerSecond),
      ns.formatRam(data.batchRam),
      data.batches.toString(),
    ]),
  })

  // Extract primary text color from game's CSS
  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = window.getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create pre element for monospace formatting
  const pre = document.createElement("pre")
  pre.style.margin = "0"
  pre.style.fontFamily = "inherit"
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
  const contentWidth = Math.min(maxLineLength * 7.2 + 40, window.innerWidth - 100)

  // Create floating window
  new FloatingWindow({
    title: `Target Profitability Analysis (${profitabilityData.length} servers, ${ns.formatRam(totalMaxRam)} RAM)`,
    content: pre,
    width: contentWidth,
    height: 600,
    id: "target-analysis-window",
  })
}
