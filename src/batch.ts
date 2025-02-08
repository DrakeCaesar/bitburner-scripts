import { NS, Person, Player, Server } from "@ns"
export async function main(ns: NS) {
  const target = ns.args[0] as string
  const host = ns.getHostname() as string
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0.01
  const moneyTolerance = 0.99
  const prepWeakenDelay = 100
  const hackThreshold = 0.25

  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores
  ns.tprint(`cores: ${myCores}`)

  const serverActual = ns.getServer(target)
  const growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores)
  )
  if (growThreads > 0) {
    ns.tprint(`Prep: Executing grow with ${growThreads} threads on ${target}.`)
    ns.exec("/hacking/grow.js", host, growThreads, target, 0)
  } else {
    ns.tprint(`Prep: Grow not needed on ${target}.`)
  }

  await ns.sleep(prepWeakenDelay)

  const addedSecurity = ns.growthAnalyzeSecurity(growThreads, target, myCores)
  const currentSec = ns.getServerSecurityLevel(target)
  const expectedSecAfterGrow = currentSec + addedSecurity
  const secToReduce = expectedSecAfterGrow - baseSecurity
  const weakenThreadsPre = Math.ceil(
    secToReduce / (0.05 * (1 + (myCores - 1) / 16))
  )

  if (weakenThreadsPre > 0) {
    ns.tprint(
      `Prep: Executing weaken with ${weakenThreadsPre} threads on ${target}.`
    )
    ns.exec("/hacking/weaken.js", host, weakenThreadsPre, target, 0)
  } else {
    ns.tprint(`Prep: Weaken not needed on ${target} (security is at base).`)
  }

  const growTime = ns.formulas.hacking.growTime(serverActual, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
  const waitTime = Math.max(growTime, weakenTime) + 200
  ns.tprint(`Prep: Waiting ${waitTime} ms for grow/weaken to complete...`)
  await ns.sleep(waitTime)

  const postMoney = ns.getServerMoneyAvailable(target)
  const postSec = ns.getServerSecurityLevel(target)
  if (postMoney < moneyMax * moneyTolerance) {
    ns.tprint(`WARNING: Money is only ${postMoney} (target ${moneyMax}).`)
  }
  if (postSec > baseSecurity + secTolerance) {
    ns.tprint(`WARNING: Security is ${postSec} (target ${baseSecurity}).`)
  }
  ns.tprint(
    `Prep complete on ${target}: ${postMoney} money, ${postSec} security.`
  )

  function prepForHack(server: Server, player: Player) {
    server.money = server.moneyMax!
    server.addedSecurity = 0
    server.security = server.baseSecurity
    return { server, player }
  }
  function prepForWeaken(server: Server, player: Player, hackThreads: number) {
    server.addedSecurity = ns.hackAnalyzeSecurity(hackThreads)
    server.security = server.baseSecurity + server.addedSecurity

    return { server, player }
  }
  function prepForGrow(server: Server, player: Player) {
    server.moneyAvailable = server.moneyMax! * hackThreshold
    server.addedSecurity = 0
    server.security = server.baseSecurity

    return { server, player }
  }
  function prepForWeaken2(server: Server, player: Player, growThreads: number) {
    server.addedSecurity = ns.growthAnalyzeSecurity(
      growThreads,
      target,
      myCores
    )
    server.security = server.baseSecurity + server.addedSecurity

    return { server, player }
  }

  function calculateHackThreads(server: Server, player: Person) {
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil(
      (moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax)
    )
  }
  function calculateWeakenThreads(server: Server, player: Player) {
    return Math.ceil(server.addedSecurity / (0.05 * (1 + (myCores - 1) / 16)))
  }
  function calculateGrowThreads(server: Server, player: Person) {
    return Math.ceil(
      ns.formulas.hacking.growThreads(server, player, moneyMax, myCores)
    )
  }
  function calculateWeakenThreads2(server: Server, player: Player) {
    return calculateWeakenThreads(server, player)
  }

  let batchCounter = 0
  ns.tprint("Entering main batching loop.")
  while (true) {
    const player = ns.getPlayer()
    const server = ns.getServer(target)
    const { server: hackServer, player: hackPlayer } = prepForHack(
      server,
      player
    )
    const hackThreads = calculateHackThreads(hackServer, hackPlayer)

    const { server: weakenServer, player: weakenPlayer } = prepForWeaken(
      server,
      player,
      hackThreads
    )
    const weakenThreads1 = calculateWeakenThreads(weakenServer, weakenPlayer)

    const { server: growServer, player: growPlayer } = prepForGrow(
      server,
      player
    )
    const growThreads = calculateGrowThreads(growServer, growPlayer)
    // ns.tprint(`Batch ${batchCounter}: grow ${growThreads}`)

    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(
      server,
      player,
      growThreads
    )
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player)

    function getDeltaInterval(hackTime: number, index: number) {
      if (index === 0) {
        return [hackTime, Infinity]
      }
      const lowerBound = hackTime / (2 * index + 1)
      const upperBound = hackTime / (2 * index)
      return [lowerBound, upperBound]
    }

    function getDelta(hackTime: number, index: number) {
      if (index === 0) {
        return hackTime
      }
      const [lower, upper] = getDeltaInterval(hackTime, index)
      return (lower + upper) / 2;
    }

    const hackTime = ns.formulas.hacking.hackTime(server, player)
    const weakenTime = ns.formulas.hacking.weakenTime(server, player)
    const growTime = ns.formulas.hacking.growTime(server, player)

    const batchDelay = getDelta(hackTime, 1)

    const baseline = weakenTime

    const offset = batchCounter * 4 * batchDelay

    const finishHack = baseline + offset - batchDelay
    const finishWeaken1 = baseline + offset
    const finishGrow = baseline + offset + batchDelay
    const finishWeaken2 = baseline + offset + 2 * batchDelay

    const sleepHack = finishHack - hackTime
    const sleepWeaken1 = finishWeaken1 - weakenTime
    const sleepGrow = finishGrow - growTime
    const sleepWeaken2 = finishWeaken2 - weakenTime

    // // Debug printing: show sleep times, finish times, and the differences between finish times.
    // ns.tprint(`Batch ${batchCounter} Debug Info:`)
    // ns.tprint(`  hackTime: ${hackTime}`)
    // ns.tprint(`  weakenTime: ${weakenTime}`)
    // ns.tprint(`  growTime: ${growTime}`)
    // ns.tprint(`  batchDelay: ${batchDelay}`)
    // ns.tprint(`  offset: ${offset}`)
    // ns.tprint("")
    // ns.tprint(`  Sleep Hack:    ${sleepHack}  -> Finish Hack:    ${finishHack}`)
    // ns.tprint(
    //   `  Sleep Weaken1: ${sleepWeaken1}  -> Finish Weaken1: ${finishWeaken1}`
    // )
    // ns.tprint(`  Sleep Grow:    ${sleepGrow}  -> Finish Grow:    ${finishGrow}`)
    // ns.tprint(
    //   `  Sleep Weaken2: ${sleepWeaken2}  -> Finish Weaken2: ${finishWeaken2}`
    // )
    // ns.tprint("")
    // ns.tprint(
    //   `  Finish Diffs: Hack->Weaken1: ${(finishWeaken1 - finishHack).toFixed(2)}, ` +
    //     `Weaken1->Grow: ${(finishGrow - finishWeaken1).toFixed(2)}, ` +
    //     `Grow->Weaken2: ${(finishWeaken2 - finishGrow).toFixed(2)}`
    // )
    // ns.tprint("--------------------------------------------------")

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)

    batchCounter++
    await ns.sleep(4 * batchDelay)
  }
}
