/** @param {import("../..").NS } ns */
export async function main(ns) {
   //ns.disableLog("ALL")
   let node = ns.args[0]
   let target = ns.args[1]
   let proc = 0.95
   let playerLevel = ns.getPlayer().hacking
   let oldPlayerLevel
   let updateHack = false
   let updateGrow = false
   let paramsString
   paramsString = ns.read("/data/" + target + ".txt")
   let params
   if (paramsString) {
      params = JSON.parse(paramsString)
      oldPlayerLevel = params.oldPlayerLevel - playerLevel
   }
   if (!params || !oldPlayerLevel <= playerLevel - 5) {
      params = await getLoopParams(ns, node, target, proc)
      oldPlayerLevel = playerLevel
   }
   //ns.tprint(JSON.stringify(params, null, 4))
   //for (let id = Math.floor(Math.random() * 1000000000) * 4 + 1; ; id++) {
   for (let id = 1; ; id++) {
      playerLevel = ns.getPlayer().hacking
      if (playerLevel > oldPlayerLevel) {
         updateHack = true
         updateGrow = true
         oldPlayerLevel = playerLevel
      }
      if (updateHack || updateGrow) {
         let tempHack = getHack(ns, node, target, proc)
         let tempGrow = getGrow(ns, node, target, proc)
         if (tempHack) {
            params.hack = tempHack
            params = await getParams(ns, node, target, params)
            updateHack = false
         }
         if (tempGrow) {
            params.grow = tempGrow
            params = await getParams(ns, node, target, params)
            updateGrow = false
         }
      }
      serverStats(ns, target)

      if (id % 4 == 1) {
         await hack(ns, node, target, params, id)
      } else if (id % 4 == 3) {
         await grow(ns, node, target, params, id)
      } else {
         await weaken(ns, node, target, params, id)
      }
   }
}

/** @param {import("../..").NS } ns */
export async function hack(ns, node, target, params, id) {
   ns.exec(
      "/hacking/hack.js",
      node,
      params.hack.threads,
      target,
      params.hack.time,
      id,
      true
   )
   await ns.sleep(params.interval.adjustedMargin)
}
/** @param {import("../..").NS } ns */
export async function grow(ns, node, target, params, id) {
   ns.exec(
      "/hacking/grow.js",
      node,
      params.grow.threads,
      target,
      params.grow.time,
      id,
      true
   )
   await ns.sleep(params.interval.adjustedMargin)
}
/** @param {import("../..").NS } ns */
export async function weaken(ns, node, target, params, id) {
   let iteration = 0
   while (
      ns.getServerSecurityLevel(target) !=
         ns.getServerMinSecurityLevel(target) &&
      iteration++ < 10
   ) {
      await ns.sleep(params.interval.adjustedMargin / 10)
   }
   ns.exec(
      "/hacking/weaken.js",
      node,
      id % 4 == 2 ? params.hack.threads : params.grow.threads,
      target,
      id
   )
   await ns.sleep(params.interval.adjustedMargin)
}

/** @param {import("../..").NS } ns */
export function getHack(ns, node, target, proc) {
   const maxRam =
      (ns.getServerMaxRam(node) -
         ns.getScriptRam("/hacking/autoHackParallel.js")) *
      0.9
   let server = ns.getServer(target)

   if (
      server.moneyAvailable != server.moneyMax ||
      server.minDifficulty != server.hackDifficulty
   ) {
      return null
   }
   const threads = Math.min(
      Math.floor(ns.hackAnalyzeThreads(target, server.moneyMax * proc)),
      Math.floor(maxRam / 4)
   )
   const security = threads * 0.002
   const weakenThreads = Math.min(
      Math.ceil(security / 0.05),
      Math.floor(maxRam / 4)
   )
   return {
      threads: threads,
      time: ns.getWeakenTime(target) - ns.getHackTime(target),
      security: security,
      weakenThreads,
      weakenTime: ns.getWeakenTime(target),
   }
}

/** @param {import("../..").NS } ns */
export function getGrow(ns, node, target, proc) {
   const maxRam =
      (ns.getServerMaxRam(node) -
         ns.getScriptRam("/hacking/autoHackParallel.js")) *
      0.9

   let server = ns.getServer(target)

   if (
      server.minDifficulty != server.hackDifficulty ||
      server.moneyAvailable > server.moneyMax * (1 - proc) * 1.2 ||
      server.moneyAvailable < (server.moneyMax * (1 - proc)) / 1.2
   ) {
      return null
   }
   const threads = Math.min(
      Math.ceil(ns.growthAnalyze(target, 1 / (1 - proc))),
      Math.floor(maxRam / 4)
   )
   const security = threads * 0.004
   const weakenThreads = Math.min(
      Math.ceil(security / 0.05),
      Math.ceil(maxRam / 4)
   )

   return {
      threads: threads,
      time: ns.getWeakenTime(target) - ns.getGrowTime(target),
      security: security,
      weakenThreads: weakenThreads,
      weakenTime: ns.getWeakenTime(target),
   }
}

/** @param {import("../..").NS } ns */
export async function getParams(ns, node, target, params) {
   const maxRam =
      (ns.getServerMaxRam(node) -
         ns.getScriptRam("/hacking/autoHackParallel.js")) *
      0.9
   const loopRam =
      params.hack.weakenThreads * ns.getScriptRam("/hacking/weaken.js") +
      params.grow.weakenThreads * ns.getScriptRam("/hacking/weaken.js") +
      params.hack.threads * ns.getScriptRam("/hacking/hack.js") +
      params.grow.threads * ns.getScriptRam("/hacking/grow.js")
   const instances = maxRam / loopRam
   const margin = params.hack.weakenTime / instances / 2
   const safeMargin = 25
   const adjustedMargin = Math.max(margin, safeMargin)
   const level = ns.getPlayer().hacking
   //const adjustedMargin = margin
   params.interval = {
      target: target,
      level: level,
      margin: margin,
      safeMargin: safeMargin,
      adjustedMargin: adjustedMargin,
   }
   await ns.write(
      "/data/" + params.interval.target + ".txt",
      JSON.stringify(params, null, 4),
      "w"
   )
   await ns.scp("/data/" + params.interval.target + ".txt", "home")

   return params
}

/** @param {import("../..").NS } ns */
export async function getLoopParams(ns, node, target, proc) {
   const maxRam =
      (ns.getServerMaxRam(node) -
         ns.getScriptRam("/hacking/autoHackParallel.js")) *
      0.9
   let grow = getGrow(ns, node, target, proc)
   let hack = getHack(ns, node, target, proc)
   let actionPid = null
   let weakenPid = null
   while (!grow || !hack) {
      serverStats(ns, target)

      if (!hack && !grow) {
         let curProc =
            ns.getServerMoneyAvailable(target) / ns.getServerMaxMoney(target)

         let threads = Math.min(
            curProc
               ? Math.ceil(ns.growthAnalyze(target, 1 / curProc))
               : Math.floor(maxRam / 4),

            Math.floor(maxRam / 4)
         )
         let security =
            threads * 0.004 +
            ns.getServerSecurityLevel(target) -
            ns.getServerMinSecurityLevel(target)
         let weakenThreads = Math.min(
            Math.ceil((security / 0.05) * 1.25),
            Math.floor(maxRam / 4)
         )
         let weakenTime = ns.getWeakenTime(target)
         let growthTime = ns.getWeakenTime(target)
         if (threads) {
            actionPid = ns.exec("/hacking/grow.js", node, threads, target)
         }
         if (weakenThreads) {
            weakenPid = ns.exec(
               "/hacking/weaken.js",
               node,
               weakenThreads,
               target
            )
            await ns.sleep(weakenTime)
         } else {
            await ns.sleep(growthTime)
         }
      } else if (grow) {
         actionPid = ns.exec("/hacking/grow.js", node, grow.threads, target)
         weakenPid = ns.exec(
            "/hacking/weaken.js",
            node,
            grow.weakenThreads,
            target
         )
         await ns.sleep(grow.weakenTime)
      } else if (hack) {
         actionPid = ns.exec("/hacking/hack.js", node, hack.threads, target)
         weakenPid = ns.exec(
            "/hacking/weaken.js",
            node,
            hack.weakenThreads,
            target
         )
         await ns.sleep(hack.weakenTime)
      }
      while (
         (actionPid && ns.getRunningScript(actionPid)) ||
         (weakenPid && ns.getRunningScript(weakenPid))
      ) {
         await ns.sleep(100)
      }
      let tempGrow = getGrow(ns, node, target, proc)
      let tempHack = getHack(ns, node, target, proc)
      if (tempGrow) grow = tempGrow
      if (tempHack) hack = tempHack
   }

   return await getParams(ns, node, target, { hack: hack, grow: grow })
}

/** @param {import("../..").NS } ns */
export function serverStats(ns, target) {
   let server = ns.getServer(target)
   ns.print(
      "server security: " +
         (server.hackDifficulty - server.minDifficulty).toFixed(2)
   )

   ns.print(
      "server money:    " +
         ((server.moneyAvailable / server.moneyMax) * 100).toFixed(2) +
         "%"
   )
   ns.print("")

   ns.print(server.moneyAvailable)
   ns.print(server.moneyMax)
}
