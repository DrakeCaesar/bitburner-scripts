import { NS } from "@ns"
import { FloatingWindow } from "./libraries/floatingWindow.js"

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

  await createNodesWindow(ns)
}

interface NodeInfo {
  name: string
  exists: boolean
  ram: number
  ramFormatted: string
  progressBar: string
}

async function createNodesWindow(ns: NS): Promise<void> {
  // Remove existing window if it exists
  const existingWindow = eval("document").querySelector("#nodes-window")
  if (existingWindow) {
    existingWindow.remove()
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
        // Very start
        result += i < bars ? FILLED_LEFT : EMPTY_LEFT
      } else if (i === totalChars - 1) {
        // Very end
        result += i < bars ? FILLED_RIGHT : EMPTY_RIGHT
      } else {
        // Middle section
        result += i < bars ? FILLED_CENTER : EMPTY_CENTER
      }
    }

    return result
  }

  function updateTable(): void {
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

    // Determine next action and calculate savings progress
    let nextAction = "Save money"
    let savingsInfo = ""

    if (bestRam >= maxRam) {
      // Already maxed out
      nextAction = `All servers maxed at ${ns.formatRam(maxRam)}`
      // savingsInfo = `No upgrades available`
      // show max cost
      savingsInfo = `Max server RAM reached (${ns.formatRam(maxRam)}) - Cost to purchase: ${ns.formatNumber(cost)}`
    } else if (money >= cost) {
      // Can afford the target
      if (existingNodes.length < 25) {
        nextAction = `Buy ${ns.formatRam(targetRam)} server (${ns.formatNumber(cost)})`
      } else {
        const worstNode = existingNodes.reduce((min, n) => (n.ram < min.ram ? n : min))
        nextAction = `Upgrade ${worstNode.name} to ${ns.formatRam(targetRam)} (${ns.formatNumber(cost)})`
      }
      savingsInfo = `Ready to purchase!`
    } else {
      // Saving for target
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

    // Build table header
    const tableHeader =
      `┏━${"━".repeat(nameLen)}━┳━${"━".repeat(ramLen)}━┳━${"━".repeat(progressLen)}━┳━${"━".repeat(statusLen)}━┓\n` +
      `┃ ${nameCol.padEnd(nameLen)} ┃ ${ramCol.padEnd(ramLen)} ┃ ${progressCol.padEnd(progressLen)} ┃ ${statusCol.padEnd(statusLen)} ┃\n` +
      `┣━${"━".repeat(nameLen)}━╋━${"━".repeat(ramLen)}━╋━${"━".repeat(progressLen)}━╋━${"━".repeat(statusLen)}━┫\n`

    const tableFooter =
      `┗━${"━".repeat(nameLen)}━┻━${"━".repeat(ramLen)}━┻━${"━".repeat(progressLen)}━┻━${"━".repeat(statusLen)}━┛\n` +
      `\nServers: ${existingNodes.length}/25 | Total RAM: ${ns.formatRam(totalRam)} | Avg: ${ns.formatRam(avgRam)}\n` +
      `Min: ${ns.formatRam(minRam)} | Max: ${ns.formatRam(maxNodeRam)} | System Max: ${ns.formatRam(maxRam)}\n` +
      `Next: ${nextAction}\n` +
      `${savingsInfo}`

    // Clear and rebuild container
    containerDiv.innerHTML = ""

    // Add header
    const headerSpan = eval("document").createElement("span")
    headerSpan.textContent = tableHeader
    containerDiv.appendChild(headerSpan)

    // Add rows with conditional coloring
    for (const node of nodes) {
      const rowSpan = eval("document").createElement("span")
      rowSpan.textContent = `┃ ${node.name.padEnd(nameLen)} ┃ `
      containerDiv.appendChild(rowSpan)

      const ramSpan = eval("document").createElement("span")
      ramSpan.textContent = node.ramFormatted.padEnd(ramLen)
      if (node.exists) {
        // Color code based on RAM
        if (node.ram === maxRam) {
          ramSpan.style.color = "#00ff00" // Green for max RAM
        } else if (node.ram === minRam) {
          ramSpan.style.color = "#ff4444" // Red for minimum RAM
        } else if (node.ram >= avgRam) {
          ramSpan.style.color = "#44ff44" // Light green for above average
        } else {
          ramSpan.style.color = "#ffaa00" // Orange for below average
        }
      } else {
        ramSpan.style.color = "#666666" // Gray for non-existent
      }
      containerDiv.appendChild(ramSpan)

      const midSpan1 = eval("document").createElement("span")
      midSpan1.textContent = " ┃ "
      containerDiv.appendChild(midSpan1)

      const progressSpan = eval("document").createElement("span")
      progressSpan.textContent = node.progressBar
      if (node.exists) {
        // Same color coding as RAM
        if (node.ram === maxRam) {
          progressSpan.style.color = "#00ff00"
        } else if (node.ram === minRam) {
          progressSpan.style.color = "#ff4444"
        } else if (node.ram >= avgRam) {
          progressSpan.style.color = "#44ff44"
        } else {
          progressSpan.style.color = "#ffaa00"
        }
      } else {
        progressSpan.style.color = "#666666"
      }
      containerDiv.appendChild(progressSpan)

      const midSpan2 = eval("document").createElement("span")
      midSpan2.textContent = " ┃ "
      containerDiv.appendChild(midSpan2)

      const statusSpan = eval("document").createElement("span")
      const status = node.exists ? "●" : "○"
      statusSpan.textContent = status.padEnd(statusLen)
      if (node.exists) {
        statusSpan.style.color = "#00ff00"
      } else {
        statusSpan.style.color = "#666666"
      }
      containerDiv.appendChild(statusSpan)

      const endSpan = eval("document").createElement("span")
      endSpan.textContent = " ┃\n"
      containerDiv.appendChild(endSpan)
    }

    // Add footer
    const footerSpan = eval("document").createElement("span")
    footerSpan.textContent = tableFooter
    containerDiv.appendChild(footerSpan)
  }

  // Initial render
  updateTable()

  // Create floating window
  new FloatingWindow({
    title: "Server Nodes (● = active, ○ = empty, Progress = RAM doublings)",
    content: containerDiv,
    width: 600,
    height: 700,
    id: "nodes-window",
  })

  // Update every 2 seconds
  while (true) {
    await ns.sleep(2000)
    // Check if window still exists
    if (!eval("document").querySelector("#nodes-window")) {
      break
    }
    updateTable()
  }
}
