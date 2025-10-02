import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateOperationXp,
  calculateWeakThreads,
  copyRequiredScripts,
  growServerInstance,
  hackServerInstance,
  killOtherInstances,
  prepareServer,
  updatePlayerWithXp,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
// import { initBatchVisualiser, logBatchOperation } from "./batchVisualiser.js"
import { main as autoNuke } from "./autoNuke.js"
import { upgradeServer } from "./buyServer.js"
import { findBestTarget } from "./findBestTarget.js"

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  await killOtherInstances(ns)

  // Get all purchased servers (nodes)
  function getAllNodes(): string[] {
    const nodes: string[] = []
    for (let i = 0; i < 25; i++) {
      const nodeName = "node" + String(i).padStart(2, "0")
      if (ns.serverExists(nodeName)) {
        nodes.push(nodeName)
      }
    }
    return nodes
  }

  while (true) {
    // initBatchVisualiser()

    // Purchase TOR router if we don't have it
    if (!ns.hasTorRouter()) {
      const torCost = 200000 // TOR router costs $200k
      if (ns.getPlayer().money >= torCost) {
        if (ns.singularity.purchaseTor()) {
          ns.tprint("Purchased TOR router")
        }
      }
    }

    // Purchase port-opening programs if we have TOR and can afford them
    if (ns.hasTorRouter()) {
      const programs = [
        { name: "BruteSSH.exe", cost: 500000 },
        { name: "FTPCrack.exe", cost: 1500000 },
        { name: "relaySMTP.exe", cost: 5000000 },
        { name: "HTTPWorm.exe", cost: 30000000 },
        { name: "SQLInject.exe", cost: 250000000 },

        { name: "ServerProfiler.exe", cost: 500000 },
        { name: "DeepscanV1.exe", cost: 500000 },
        { name: "DeepscanV2.exe", cost: 25000000 },
        { name: "AutoLink.exe", cost: 1000000 },
      ]

      for (const program of programs) {
        if (!ns.fileExists(program.name, "home")) {
          if (ns.getPlayer().money >= program.cost) {
            if (ns.singularity.purchaseProgram(program.name)) {
              ns.tprint(`Purchased ${program.name}`)
            }
          }
        }
      }
    }

    // Run autoNuke to gain access to new servers
    await autoNuke(ns)

    // Try to upgrade node00 first
    const wasUpgraded = upgradeServer(ns, "node00")
    if (wasUpgraded) {
      ns.tprint("Server was upgraded, restarting batch cycle...")
    }

    // If node00 is maxed out, try to buy additional servers
    if (ns.serverExists("node00")) {
      const maxRam = ns.getPurchasedServerMaxRam()
      const currentRam = ns.getServerMaxRam("node00")

      if (currentRam >= maxRam) {
        const cost = ns.getPurchasedServerCost(maxRam)
        const money = ns.getPlayer().money

        // Buy as many maxed servers as we can afford
        for (let i = 1; i < 25; i++) {
          const nodeName = "node" + String(i).padStart(2, "0")

          if (!ns.serverExists(nodeName) && money >= cost) {
            ns.purchaseServer(nodeName, maxRam)
            ns.tprint(`Bought new maxed server: ${nodeName} (${maxRam} GB)`)
            break
          } else if (ns.serverExists(nodeName) && ns.getServerMaxRam(nodeName) < maxRam && money >= cost) {
            ns.killall(nodeName)
            ns.deleteServer(nodeName)
            ns.purchaseServer(nodeName, maxRam)
            ns.tprint(`Upgraded ${nodeName} to max RAM (${maxRam} GB)`)
            break
          }
        }
      }
    }

    let nodes = getAllNodes()
    if (nodes.length === 0) {
      ns.tprint("No purchased servers found, using home...")
      nodes = ["home"]
    } else {
      // Check if home has more RAM than purchased servers
      const homeRam = ns.getServerMaxRam("home")
      const totalPurchasedRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)

      if (homeRam > totalPurchasedRam) {
        ns.tprint(
          `Home has more RAM (${ns.formatRam(homeRam)}) than purchased servers (${ns.formatRam(totalPurchasedRam)}), using home...`
        )
        nodes = ["home"]
      }
    }

    // Kill all scripts on all nodes and copy required scripts
    for (const node of nodes) {
      ns.killall(node)
      await copyRequiredScripts(ns, node)
    }

    const batchDelay = 50

    // Calculate total RAM across all nodes
    const totalMaxRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
    const myCores = ns.getServer(nodes[0]).cpuCores

    // Find best target automatically
    const target = findBestTarget(ns, totalMaxRam, myCores, batchDelay, playerHackLevel)

    const player = ns.getPlayer()
    const ramThreshold = 0.9

    // Use the optimal threshold from findBestTarget
    const hackThreshold = target.hackThreshold
    ns.tprint(`Target: ${target.serverName}`)
    ns.tprint(`Using ${nodes.length} node(s) with ${ns.formatRam(totalMaxRam)} total RAM`)
    ns.tprint(
      `Using optimal hack threshold: ${(hackThreshold * 100).toFixed(2)}% (${ns.formatNumber(target.moneyPerSecond)}/sec)`
    )

    // Create a simulated prepared server (min security, max money)
    const server = ns.getServer(target.serverName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax
    const moneyMax = server.moneyMax!

    const weakenTime = ns.formulas.hacking.weakenTime(server, player)

    const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
    const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
    const growScriptRam = ns.getScriptRam("/hacking/grow.js")

    // Now actually prepare the server (use first node for prep)
    await prepareServer(ns, nodes[0], target.serverName)

    const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, hackThreshold, ns)

    const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
    const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

    const { server: growServer, player: growPlayer } = growServerInstance(server, player, hackThreshold)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

    const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
    const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

    const hackServerRam = ns.getScriptRam("/hacking/hack.js") * hackThreads
    const wkn1ServerRam = ns.getScriptRam("/hacking/weaken.js") * wkn1Threads
    const growServerRam = ns.getScriptRam("/hacking/grow.js") * growThreads
    const wkn2ServerRam = ns.getScriptRam("/hacking/weaken.js") * wkn2Threads
    const totalBatchRam = hackServerRam + wkn1ServerRam + growServerRam + wkn2ServerRam

    const batches = Math.floor((totalMaxRam / totalBatchRam) * ramThreshold)

    const hackTime = ns.formulas.hacking.hackTime(server, player)
    const growTime = ns.formulas.hacking.growTime(server, player)

    ns.tprint(`Using batch delay of ${ns.tFormat(batchDelay)}`)

    const hackAdditionalMsec = weakenTime - batchDelay - hackTime
    const wkn1AdditionalMsec = 0
    const growAdditionalMsec = weakenTime + batchDelay - growTime
    const wkn2AdditionalMsec = 2 * batchDelay

    ns.tprint(
      `Batch RAM: ${totalBatchRam.toFixed(2)} GB - Threads (H:${hackThreads} W1:${wkn1Threads} G:${growThreads} W2:${wkn2Threads})`
    )
    ns.tprint(`Can run ${batches} batches in parallel (${ns.formatRam(totalMaxRam)} total RAM)`)
    ns.tprint(`Weaken time: ${ns.tFormat(weakenTime)}`)
    ns.tprint(`Batch interval: ${ns.tFormat(batchDelay * 4)}`)

    const minSecurity = ns.getServerMinSecurityLevel(target.serverName)
    const preHackSecurityIncrease = ns.getServerSecurityLevel(target.serverName) - minSecurity
    if (preHackSecurityIncrease > 0) {
      ns.tprint(`WARNING: ${target.serverName} security above minimum by ${preHackSecurityIncrease.toFixed(2)}`)
    }

    const preGrowSecurityIncrease = ns.getServerSecurityLevel(target.serverName) - minSecurity
    if (preGrowSecurityIncrease > ns.hackAnalyzeSecurity(hackThreads, target.serverName)) {
      ns.tprint(`WARNING: ${target.serverName} security above minimum by ${preGrowSecurityIncrease.toFixed(2)}`)
    }

    // Helper to find a node with enough RAM for a given number of threads
    function findNodeForThreads(threads: number, scriptRam: number): string | null {
      const neededRam = threads * scriptRam
      for (const node of nodes) {
        const availableRam = ns.getServerMaxRam(node) - ns.getServerUsedRam(node)
        if (availableRam >= neededRam) {
          return node
        }
      }
      return null
    }

    // Launch all batches at once, distributing across nodes
    const currentTime = Date.now()
    let lastPid = 0

    // Track player state as operations complete to predict hacking level
    let currentPlayer = { ...player }

    for (let batchCounter = 0; batchCounter < batches; batchCounter++) {
      const batchOffset = batchCounter * batchDelay * 4

      const hackXp = calculateOperationXp(server, currentPlayer, hackThreads, ns)

      const playerAfterHack = updatePlayerWithXp(currentPlayer, hackXp, ns)
      const expectedHackXp = playerAfterHack.exp.hacking
      const expectedHackLevel = playerAfterHack.skills.hacking

      const wkn1Xp = calculateOperationXp(server, playerAfterHack, wkn1Threads, ns)

      const playerAfterWkn1 = updatePlayerWithXp(playerAfterHack, wkn1Xp, ns)
      const expectedWkn1Xp = playerAfterWkn1.exp.hacking
      const expectedWkn1Level = playerAfterWkn1.skills.hacking

      const growXp = calculateOperationXp(server, playerAfterWkn1, growThreads, ns)

      const playerAfterGrow = updatePlayerWithXp(playerAfterWkn1, growXp, ns)
      const expectedGrowXp = playerAfterGrow.exp.hacking
      const expectedGrowLevel = playerAfterGrow.skills.hacking

      const wkn2Xp = calculateOperationXp(server, playerAfterGrow, wkn2Threads, ns)

      const playerAfterWkn2 = updatePlayerWithXp(playerAfterGrow, wkn2Xp, ns)
      const expectedWkn2Xp = playerAfterWkn2.exp.hacking
      const expectedWkn2Level = playerAfterWkn2.skills.hacking

      // Update current player state for next batch calculations
      currentPlayer = playerAfterWkn2

      // Find nodes for each operation
      const hackNode = findNodeForThreads(hackThreads, hackScriptRam)
      const wkn1Node = findNodeForThreads(wkn1Threads, weakenScriptRam)
      const growNode = findNodeForThreads(growThreads, growScriptRam)
      const wkn2Node = findNodeForThreads(wkn2Threads, weakenScriptRam)

      if (!hackNode || !wkn1Node || !growNode || !wkn2Node) {
        ns.tprint(`ERROR: Not enough RAM to launch batch ${batchCounter}`)
        break
      }

      // Launch operations with expected hacking level and XP for validation
      ns.exec(
        "/hacking/hack.js",
        hackNode,
        hackThreads,
        target.serverName,
        hackAdditionalMsec + batchOffset,
        0,
        expectedHackLevel,
        expectedHackXp
      )
      ns.exec(
        "/hacking/weaken.js",
        wkn1Node,
        wkn1Threads,
        target.serverName,
        wkn1AdditionalMsec + batchOffset,
        0,
        expectedWkn1Level,
        expectedWkn1Xp
      )
      ns.exec(
        "/hacking/grow.js",
        growNode,
        growThreads,
        target.serverName,
        growAdditionalMsec + batchOffset,
        0,
        expectedGrowLevel,
        expectedGrowXp
      )
      lastPid = ns.exec(
        "/hacking/weaken.js",
        wkn2Node,
        wkn2Threads,
        target.serverName,
        wkn2AdditionalMsec + batchOffset,
        0,
        expectedWkn2Level,
        expectedWkn2Xp
      )
    }

    // Wait for the last script to finish
    while (ns.isRunning(lastPid)) {
      await ns.sleep(100)
    }

    const finalSecurity = ns.getServerSecurityLevel(target.serverName)
    const currentMoney = ns.getServerMoneyAvailable(target.serverName)
    const maxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPercent = (currentMoney / maxMoney) * 100

    ns.tprint("SUCCESS: All batches completed")
    ns.tprint(
      `Security: ${finalSecurity.toFixed(2)} / ${minSecurity.toFixed(2)} (+${(finalSecurity - minSecurity).toFixed(2)})`
    )
    ns.tprint(`Money: ${moneyPercent.toFixed(2)}% (${ns.formatNumber(currentMoney)} / ${ns.formatNumber(maxMoney)})`)
  }
}
