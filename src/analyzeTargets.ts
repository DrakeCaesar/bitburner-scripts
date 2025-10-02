import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateWeakThreads,
  growServerInstance,
  hackServerInstance,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { crawl } from "./libraries/crawl.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"

interface ServerProfitability {
  serverName: string
  hackLevel: number
  moneyMax: number
  weakenTime: number
  optimalThreshold: number
  moneyPerSecond: number
  batchRam: number
  batches: number
}

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  // Remove existing window if it exists
  const existingWindow = eval("document").querySelector("#target-analysis-window")
  if (existingWindow) {
    existingWindow.remove()
  }

  // Get all nodes and calculate total RAM
  const nodes: string[] = []
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    if (ns.serverExists(nodeName)) {
      nodes.push(nodeName)
    }
  }

  if (nodes.length === 0) {
    nodes.push("home")
  }

  const totalMaxRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
  const myCores = nodes.length > 0 ? ns.getServer(nodes[0]).cpuCores : 1
  const batchDelay = 50

  // Get all servers
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

  const player = ns.getPlayer()
  const maxHackLevel = playerHackLevel ?? player.skills.hacking

  // Get constants
  const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")

  // Filter servers we can hack
  const hackableServers = Array.from(knownServers).filter((serverName) => {
    const server = ns.getServer(serverName)
    return server.requiredHackingSkill! <= maxHackLevel && server.moneyMax! > 0 && server.hasAdminRights
  })

  const profitabilityData: ServerProfitability[] = []

  for (const targetName of hackableServers) {
    // Simulate prepared server
    const server = ns.getServer(targetName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax
    const moneyMax = server.moneyMax!

    const weakenTime = ns.formulas.hacking.weakenTime(server, player)

    // Test different thresholds for this server
    let serverBestMoneyPerSecond = 0
    let serverBestThreshold = 0.5
    let serverBestBatchRam = 0
    let serverBestBatches = 0

    const steps = 100
    for (let i = 1; i <= steps - 1; i++) {
      const testThreshold = i / steps

      // Calculate threads for this threshold
      const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
      const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, testThreshold, ns)

      const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
      const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

      const { server: growServer, player: growPlayer } = growServerInstance(server, player, testThreshold)
      const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

      const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
      const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

      // Calculate RAM usage
      const totalBatchRam =
        hackScriptRam * hackThreads +
        weakenScriptRam * wkn1Threads +
        growScriptRam * growThreads +
        weakenScriptRam * wkn2Threads

      const batches = Math.floor((totalMaxRam / totalBatchRam) * 0.9)

      // Calculate total money per cycle
      const moneyPerBatch = moneyMax * (1 - testThreshold)
      const totalMoneyPerCycle = moneyPerBatch * batches

      // Calculate cycle time
      const lastBatchOffset = (batches - 1) * batchDelay * 4
      const lastOperationFinishTime = weakenTime + 2 * batchDelay + lastBatchOffset
      const cycleTime = lastOperationFinishTime
      const moneyPerSecond = (totalMoneyPerCycle / cycleTime) * 1000

      if (moneyPerSecond > serverBestMoneyPerSecond) {
        serverBestMoneyPerSecond = moneyPerSecond
        serverBestThreshold = testThreshold
        serverBestBatchRam = totalBatchRam
        serverBestBatches = batches
      }
    }

    profitabilityData.push({
      serverName: targetName,
      hackLevel: server.requiredHackingSkill!,
      moneyMax: moneyMax,
      weakenTime: weakenTime,
      optimalThreshold: serverBestThreshold,
      moneyPerSecond: serverBestMoneyPerSecond,
      batchRam: serverBestBatchRam,
      batches: serverBestBatches,
    })
  }

  // Sort by money per second (descending)
  profitabilityData.sort((a, b) => b.moneyPerSecond - a.moneyPerSecond)

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
