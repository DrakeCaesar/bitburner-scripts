import { NS } from "@ns"

function crawl(ns: NS, knownServers: Set<string>, hostname = ns.getHostname()): void {
  ns.scan(hostname).forEach((element) => {
    if (!knownServers.has(element)) {
      knownServers.add(element)
      crawl(ns, knownServers, element)
    }
  })
}

export async function main(ns: NS) {
  const targetArg = ns.args[0] as string | undefined
  const hackThresholdArg = ns.args[1] ? Number(ns.args[1]) : undefined
  const batchDelay = 50
  const ramThreshold = 0.9

  // Get all servers in the network
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

  // Filter servers where we have root access and RAM available
  const nodes: string[] = []
  for (const serverName of knownServers) {
    const server = ns.getServer(serverName)
    if (server.hasAdminRights && server.maxRam > 0) {
      nodes.push(serverName)
    }
  }

  if (nodes.length === 0) {
    ns.tprint("ERROR: No nodes with root access found")
    return
  }

  // Calculate total RAM and find minimum RAM per node
  const totalMaxRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
  const minNodeRam = Math.min(...nodes.map((node) => ns.getServerMaxRam(node)))
  const myCores = ns.getServer(nodes[0]).cpuCores

  // Determine target
  let targetServer: string
  let hackThreshold: number

  if (targetArg && hackThresholdArg) {
    // Manual mode: use provided target and threshold
    targetServer = targetArg
    hackThreshold = hackThresholdArg
    ns.tprint(`Manual mode: targeting ${targetServer} with ${(hackThreshold * 100).toFixed(2)}% threshold`)
  } else {
    ns.tprint("ERROR: Usage: run batchLite.js <target> <hackThreshold>")
    ns.tprint("Example: run batchLite.js n00dles 0.5")
    return
  }

  // Copy required scripts to all nodes
  const requiredScripts = ["/hacking/hack.js", "/hacking/weaken.js", "/hacking/grow.js"]
  for (const node of nodes) {
    for (const script of requiredScripts) {
      await ns.scp(script, node)
    }
  }

  // Get player and server info
  const player = ns.getPlayer()
  const server = ns.getServer(targetServer)
  server.hackDifficulty = server.minDifficulty
  server.moneyAvailable = server.moneyMax

  // Calculate timings
  const weakenTime = ns.formulas.hacking.weakenTime(server, player)
  const growTime = ns.formulas.hacking.growTime(server, player)
  const hackTime = ns.formulas.hacking.hackTime(server, player)

  const effectiveBatchDelay = Math.max(batchDelay, Math.ceil(weakenTime / 100))
  const hackStart = weakenTime - hackTime - effectiveBatchDelay
  const wkn1Start = 0
  const growStart = weakenTime - growTime + effectiveBatchDelay
  const wkn2Start = 2 * effectiveBatchDelay

  // Calculate threads
  const hackPct = ns.formulas.hacking.hackPercent(server, player)
  const hackThreads = Math.floor((server.moneyMax! - server.moneyMax! * hackThreshold) / (hackPct * server.moneyMax!))

  const hackSecurity = ns.hackAnalyzeSecurity(hackThreads, targetServer)
  const wkn1Threads = Math.max(1, Math.ceil(hackSecurity / (0.05 * (1 + (myCores - 1) / 16))))

  const serverAfterHack = { ...server }
  serverAfterHack.moneyAvailable = server.moneyMax! * hackThreshold
  const growThreads = Math.ceil(ns.formulas.hacking.growThreads(serverAfterHack, player, server.moneyMax!, myCores) + 1)

  const growSecurity = ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
  const wkn2Threads = Math.max(1, Math.ceil(growSecurity / (0.05 * (1 + (myCores - 1) / 16))))

  // Calculate RAM
  const hackRam = ns.getScriptRam("/hacking/hack.js")
  const weakenRam = ns.getScriptRam("/hacking/weaken.js")
  const growRam = ns.getScriptRam("/hacking/grow.js")

  const totalBatchRam =
    hackRam * hackThreads + weakenRam * wkn1Threads + growRam * growThreads + weakenRam * wkn2Threads

  // Use the minimum of: total RAM-based batches OR batches that fit in smallest node
  const totalRamBatches = Math.floor((totalMaxRam / totalBatchRam) * ramThreshold)
  const minNodeBatches = Math.floor((minNodeRam / totalBatchRam) * ramThreshold)
  const maxBatches = Math.min(totalRamBatches, minNodeBatches)

  ns.tprint(`Target: ${targetServer}`)
  ns.tprint(`Hack threshold: ${(hackThreshold * 100).toFixed(2)}%`)
  ns.tprint(`Using ${nodes.length} nodes with ${ns.formatRam(totalMaxRam)} total RAM`)
  ns.tprint(`Min node RAM: ${ns.formatRam(minNodeRam)}`)
  ns.tprint(`Batch RAM: ${totalBatchRam.toFixed(2)} GB`)
  ns.tprint(`Threads - H:${hackThreads} W1:${wkn1Threads} G:${growThreads} W2:${wkn2Threads}`)
  ns.tprint(
    `Running ${maxBatches} batches (limited by ${maxBatches === totalRamBatches ? "total RAM" : "smallest node"})`
  )
  ns.tprint(`Weaken time: ${ns.tFormat(weakenTime)}`)

  // Execute batches
  for (let batchNum = 0; batchNum < maxBatches; batchNum++) {
    const batchOffset = batchNum * effectiveBatchDelay * 4

    // Find nodes with enough RAM and execute
    const operations = [
      { script: "/hacking/hack.js", threads: hackThreads, delay: hackStart + batchOffset },
      { script: "/hacking/weaken.js", threads: wkn1Threads, delay: wkn1Start + batchOffset },
      { script: "/hacking/grow.js", threads: growThreads, delay: growStart + batchOffset },
      { script: "/hacking/weaken.js", threads: wkn2Threads, delay: wkn2Start + batchOffset },
    ]

    for (const op of operations) {
      let remainingThreads = op.threads
      for (const node of nodes) {
        if (remainingThreads <= 0) break
        const availableRam = ns.getServerMaxRam(node) - ns.getServerUsedRam(node)
        const scriptRam = ns.getScriptRam(op.script)
        const possibleThreads = Math.floor(availableRam / scriptRam)
        const threadsToRun = Math.min(remainingThreads, possibleThreads)

        if (threadsToRun > 0) {
          ns.exec(op.script, node, threadsToRun, targetServer, op.delay, batchNum)
          remainingThreads -= threadsToRun
        }
      }
    }
  }

  ns.tprint("All batches launched!")
}
