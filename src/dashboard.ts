import { NS } from "@ns"
import { crawl } from "./libraries/crawl.js"
import { analyzeAllServers } from "./libraries/findBestTarget.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"
import { formatTableRow, getTableBorders } from "./libraries/tableBuilder.js"

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

  // Create all three windows
  const serverListWindow = createServerListWindow(ns, primaryColor)
  const nodesWindow = createNodesWindow(ns, primaryColor)
  const targetsWindow = createTargetsWindow(ns, primaryColor)

  // Update loop - refresh all views every second
  while (true) {
    updateServerList(ns, serverListWindow.container, primaryColor)
    updateNodesView(ns, nodesWindow.container, primaryColor)
    updateTargetsView(ns, targetsWindow.container, primaryColor)
    await ns.sleep(1000)
  }
}

// ============================================================================
// SERVER LIST
// ============================================================================

interface ServerListWindow {
  window: any
  container: HTMLElement
}

function createServerListWindow(ns: NS, primaryColor: string): ServerListWindow {
  const containerDiv = eval("document").createElement("div")
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  const window = new FloatingWindow({
    title: "Server List",
    content: containerDiv,
    width: 800,
    height: 600,
    id: "server-list-window",
    x: 50,
    y: 50,
  })

  return { window, container: containerDiv }
}

function updateServerList(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
  const knownServers = crawl(ns)
  const player = ns.getPlayer()

  // Build server data with nuking
  let items = new Map<string, { level: number; server: any }>()
  for (const key of knownServers) {
    if (!key.includes("node")) {
      const level = ns.getServerRequiredHackingLevel(key)
      const server = ns.getServer(key)

      // Attempt to nuke if possible
      let numPortsOpen = 0
      if (ns.fileExists("BruteSSH.exe", "home")) {
        ns.brutessh(key)
        ++numPortsOpen
      }
      if (ns.fileExists("FTPCrack.exe", "home")) {
        ns.ftpcrack(key)
        ++numPortsOpen
      }
      if (ns.fileExists("relaySMTP.exe", "home")) {
        ns.relaysmtp(key)
        ++numPortsOpen
      }
      if (ns.fileExists("HTTPWorm.exe", "home")) {
        ns.httpworm(key)
        ++numPortsOpen
      }
      if (ns.fileExists("SQLInject.exe", "home")) {
        ns.sqlinject(key)
        ++numPortsOpen
      }
      if (
        ns.fileExists("NUKE.exe", "home") &&
        level <= player.skills.hacking &&
        ns.getServerNumPortsRequired(key) <= numPortsOpen
      ) {
        ns.nuke(key)
      }

      // Re-get server to get updated root status
      items.set(key, { level, server: ns.getServer(key) })
    }
  }

  // Sort by hacking level
  items = new Map([...items].sort((a, b) => a[1].level - b[1].level))

  // Calculate column widths
  const nameCol = "Server"
  const lvlCol = "Level"
  const rootCol = "Root"
  const backdoorCol = "BD"
  const secCol = "Security"
  const ramCol = "RAM"
  const moneyCol = "Money"
  const timeCol = "Time"

  let nameLen = nameCol.length
  let lvlLen = lvlCol.length + 2 // +2 for " X" suffix
  let rootLen = rootCol.length
  let backdoorLen = backdoorCol.length
  let secLen = secCol.length
  let ramLen = ramCol.length
  let moneyLen = moneyCol.length
  let timeLen = timeCol.length

  for (const [target, { level, server }] of items) {
    nameLen = Math.max(nameLen, target.length)
    lvlLen = Math.max(lvlLen, (level.toString() + " X").length)
    rootLen = Math.max(rootLen, 1)
    backdoorLen = Math.max(backdoorLen, 1)
    secLen = Math.max(secLen, ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2).length)
    ramLen = Math.max(ramLen, ns.formatRam(server.maxRam).length)
    moneyLen = Math.max(moneyLen, ns.formatNumber(server.moneyMax ?? 0).length)
    timeLen = Math.max(timeLen, ns.tFormat(ns.getWeakenTime(target)).length)
  }

  // Build table
  const colWidths = [nameLen, lvlLen, rootLen, backdoorLen, secLen, ramLen, moneyLen, timeLen]
  const borders = getTableBorders(colWidths)

  const headerCells = [
    nameCol.padEnd(nameLen),
    lvlCol.padStart(lvlLen),
    rootCol.padStart(rootLen),
    backdoorCol.padStart(backdoorLen),
    secCol.padStart(secLen),
    ramCol.padStart(ramLen),
    moneyCol.padStart(moneyLen),
    timeCol.padStart(timeLen),
  ]

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add header
  const headerSpan = eval("document").createElement("span")
  headerSpan.textContent = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  containerDiv.appendChild(headerSpan)

  // Add rows
  for (const [target, { level, server }] of items) {
    const hackable = level <= player.skills.hacking ? " " : "X"
    const hasRoot = server.hasAdminRights ? " " : "X"
    const hasBackdoor = server.backdoorInstalled ? " " : "X"
    const secDiff = ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2)
    const ram = ns.formatRam(server.maxRam)
    const money = ns.formatNumber(server.moneyMax ?? 0)
    const time = ns.tFormat(ns.getWeakenTime(target))

    const rowSpan = eval("document").createElement("span")
    rowSpan.textContent = formatTableRow([
      target.padEnd(nameLen),
      `${level} ${hackable}`.padStart(lvlLen),
      hasRoot.padStart(rootLen),
      hasBackdoor.padStart(backdoorLen),
      secDiff.padStart(secLen),
      ram.padStart(ramLen),
      money.padStart(moneyLen),
      time.padStart(timeLen),
    ])
    rowSpan.textContent += "\n"
    containerDiv.appendChild(rowSpan)
  }

  // Add footer
  const footerSpan = eval("document").createElement("span")
  footerSpan.textContent = borders.bottom()
  containerDiv.appendChild(footerSpan)
}

// ============================================================================
// PURCHASED NODES
// ============================================================================

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

function createNodesWindow(ns: NS, primaryColor: string): NodesWindow {
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
  const FILLED_LEFT = ""
  const FILLED_CENTER = ""
  const FILLED_RIGHT = ""
  const EMPTY_LEFT = ""
  const EMPTY_CENTER = ""
  const EMPTY_RIGHT = ""

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

function updateNodesView(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
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
  const statusCol = "Status"

  let nameLen = nameCol.length
  let ramLen = ramCol.length
  const progressLen = 20 // Fixed width for progress bar
  let statusLen = statusCol.length

  for (const node of nodes) {
    nameLen = Math.max(nameLen, node.name.length)
    ramLen = Math.max(ramLen, node.ramFormatted.length)
  }

  // Build table
  const colWidths = [nameLen, ramLen, progressLen, statusLen]
  const borders = getTableBorders(colWidths)

  const headerCells = [
    nameCol.padEnd(nameLen),
    ramCol.padEnd(ramLen),
    progressCol.padEnd(progressLen),
    statusCol.padEnd(statusLen),
  ]

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
      status.padEnd(statusLen),
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

// ============================================================================
// TARGET ANALYSIS
// ============================================================================

interface TargetsWindow {
  window: any
  container: HTMLElement
}

function createTargetsWindow(ns: NS, primaryColor: string): TargetsWindow {
  const containerDiv = eval("document").createElement("div")
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  const window = new FloatingWindow({
    title: "Target Analysis",
    content: containerDiv,
    width: 900,
    height: 600,
    id: "target-analysis-window",
    x: 50,
    y: 700,
  })

  return { window, container: containerDiv }
}

function updateTargetsView(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
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
  const profitabilityData = analyzeAllServers(
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
  const headerSpan = eval("document").createElement("span")
  headerSpan.textContent = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  containerDiv.appendChild(headerSpan)

  // Add rows
  for (const data of topServers) {
    const rowSpan = eval("document").createElement("span")
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
  const footerSpan = eval("document").createElement("span")
  footerSpan.textContent = `${borders.bottom()}\n\nShowing top 20 of ${profitabilityData.length} servers | Total RAM: ${ns.formatRam(totalMaxRam)}`
  containerDiv.appendChild(footerSpan)
}
