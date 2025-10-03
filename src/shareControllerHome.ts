import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  const host = "home"
  const scriptPath = "/shareRam.js"

  // Kill all existing shareRam instances
  ns.scriptKill(scriptPath, host)

  while (true) {
    const scriptRam = ns.getScriptRam(scriptPath)
    const availableRam = ns.getServerMaxRam(host) * 0.9 - ns.getServerUsedRam(host)
    const threads = Math.floor(availableRam / scriptRam)

    if (threads > 0) {
      // ns.tprint(
      //   `Starting ${threads} threads of shareRam (${ns.formatRam(threads * scriptRam)} / ${ns.formatRam(availableRam)} available)`
      // )
      ns.run(scriptPath, threads)
    } else {
      ns.tprint(`Not enough RAM to run shareRam. Need ${ns.formatRam(scriptRam)}, have ${ns.formatRam(availableRam)}`)
    }

    // Wait and check if we can add more threads
    await ns.sleep(10000)

    // Check if we can run more threads
    const currentAvailableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
    const additionalThreads = Math.floor(currentAvailableRam / scriptRam)

    if (additionalThreads > 0) {
      ns.scriptKill(scriptPath, host)
      continue // Restart with new thread count
    }
  }
}
