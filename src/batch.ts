import { NS } from "@ns"
import { copyRequiredScripts, getServersToPrep, killOtherInstances } from "./batchCalculations.js"
// import { initBatchVisualiser, logBatchOperation } from "./batchVisualiser.js"
import { main as autoNuke } from "./autoNuke.js"
import { upgradeServer } from "./buyServer.js"
import { findBestTarget } from "./findBestTarget.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { findNodeWithRam, purchaseAdditionalServers, selectOptimalNodes } from "./libraries/serverManagement.js"

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  await killOtherInstances(ns)

  while (true) {
    // initBatchVisualiser()

    // Purchase TOR router and programs
    purchaseTorRouter(ns)
    purchasePrograms(ns)

    // Run autoNuke to gain access to new servers
    await autoNuke(ns)

    // Try to upgrade node00 first
    const wasUpgraded = upgradeServer(ns, "node00")
    if (wasUpgraded) {
      ns.tprint("Server was upgraded, restarting batch cycle...")
    }

    // If node00 is maxed out, try to buy additional servers
    purchaseAdditionalServers(ns)

    // Select optimal nodes to use
    const nodes = selectOptimalNodes(ns)

    // Kill all scripts on all nodes and copy required scripts
    for (const node of nodes) {
      ns.killall(node)
      await copyRequiredScripts(ns, node)
    }

    const batchDelay = 50
    const enableParallelPrep = false
    const ramThreshold = 0.9

    // Calculate total RAM across all nodes
    const totalMaxRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
    const myCores = ns.getServer(nodes[0]).cpuCores

    // Find best target automatically
    const target = findBestTarget(ns, totalMaxRam, myCores, batchDelay, playerHackLevel)
    const player = ns.getPlayer()

    ns.tprint(`Target: ${target.serverName}`)
    ns.tprint(`Using ${nodes.length} node(s) with ${ns.formatRam(totalMaxRam)} total RAM`)
    ns.tprint(
      `Using optimal hack threshold: ${(target.hackThreshold * 100).toFixed(2)}% (${ns.formatNumber(target.moneyPerSecond)}/sec)`
    )

    // Create a simulated prepared server (min security, max money)
    const server = ns.getServer(target.serverName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax

    const weakenTime = ns.formulas.hacking.weakenTime(server, player)
    const prepScriptRam = ns.getScriptRam("/prepareServer.js")

    // Get servers to prep (target + optional parallel prep)
    const serversToPrep = getServersToPrep(
      ns,
      target.serverName,
      weakenTime,
      enableParallelPrep,
      totalMaxRam,
      prepScriptRam
    )
    const maxWeakenTime = Math.max(...serversToPrep.map((s) => s.weakenTime))

    if (serversToPrep.length > 1) {
      ns.tprint(
        `Preparing ${serversToPrep.length} servers in parallel (max ${ns.tFormat(maxWeakenTime)}): ${serversToPrep.map((s) => s.name).join(", ")}`
      )
    } else {
      ns.tprint(`Preparing ${target.serverName}...`)
    }

    // Launch prep scripts in parallel
    const prepPids: number[] = []
    for (const serverInfo of serversToPrep) {
      const node = findNodeWithRam(ns, nodes, prepScriptRam)
      if (!node) {
        ns.tprint(`WARNING: Not enough RAM to prep ${serverInfo.name}, stopping parallel prep`)
        break
      }
      const pid = ns.exec("/prepareServer.js", node, 1, serverInfo.name)
      if (pid > 0) {
        prepPids.push(pid)
      } else {
        ns.tprint(`WARNING: Failed to launch prep for ${serverInfo.name}`)
      }
    }

    // Wait for all prep scripts to complete
    while (prepPids.some((pid) => ns.isRunning(pid))) {
      await ns.sleep(1000)
    }

    ns.tprint(`Server preparation complete!`)

    // Calculate batch configuration
    const batchConfig = {
      target: target.serverName,
      server,
      player,
      hackThreshold: target.hackThreshold,
      batchDelay,
      myCores,
      nodes,
      totalMaxRam,
      ramThreshold,
    }

    const threads = calculateBatchThreads(ns, batchConfig)
    const timings = calculateBatchTimings(ns, server, player, batchDelay)

    ns.tprint(`Requested batch delay: ${ns.tFormat(batchDelay)}`)
    if (timings.effectiveBatchDelay !== batchDelay) {
      ns.tprint(`Effective batch delay: ${ns.tFormat(timings.effectiveBatchDelay)} (adjusted due to low weaken time)`)
    }
    ns.tprint(
      `Batch RAM: ${threads.totalBatchRam.toFixed(2)} GB - Threads (H:${threads.hackThreads} W1:${threads.wkn1Threads} G:${threads.growThreads} W2:${threads.wkn2Threads})`
    )
    const maxBatches = Math.floor((totalMaxRam / threads.totalBatchRam) * ramThreshold)
    // const batches = Math.min(10, maxBatches) // DEBUG: Limit to 10 batches (40 ops)
    const batches = maxBatches
    ns.tprint(
      `Can run ${maxBatches} batches in parallel, limiting to ${batches} for debugging (${ns.formatRam(totalMaxRam)} total RAM)`
    )
    ns.tprint(`Weaken time: ${ns.tFormat(timings.weakenTime)}`)
    ns.tprint(`Batch interval: ${ns.tFormat(timings.effectiveBatchDelay * 4)}`)

    // Security checks
    const minSecurity = ns.getServerMinSecurityLevel(target.serverName)
    const currentSecurity = ns.getServerSecurityLevel(target.serverName)
    const securityDiff = currentSecurity - minSecurity
    if (securityDiff > 0) {
      ns.tprint(`WARNING: ${target.serverName} security above minimum by ${securityDiff.toFixed(2)}`)
    }

    // Execute batches
    await executeBatches(ns, batchConfig, threads, timings, batches)

    const finalSecurity = ns.getServerSecurityLevel(target.serverName)
    const currentMoney = ns.getServerMoneyAvailable(target.serverName)
    const maxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPercent = (currentMoney / maxMoney) * 100

    ns.tprint("SUCCESS: All batches completed")
    ns.tprint(
      `Security: ${finalSecurity.toFixed(2)} / ${minSecurity.toFixed(2)} (+${(finalSecurity - minSecurity).toFixed(2)})`
    )
    ns.tprint(`Money: ${moneyPercent.toFixed(2)}% (${ns.formatNumber(currentMoney)} / ${ns.formatNumber(maxMoney)})`)
    // break
  }
}
