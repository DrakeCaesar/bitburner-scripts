import { NS } from "@ns"
import { connect } from "./libraries/connect.js"

export async function main(ns: NS): Promise<void> {
  const backdoorAll = ns.args[0] === "all"
  const knownServers: string[] = []
  crawl(ns, knownServers)
  knownServers.sort()

  let paddingServers = 0
  let paddingLevels = 0
  for (const key of knownServers) {
    const playerLevel = ns.getPlayer().skills.hacking
    const serverLevel = ns.getServerRequiredHackingLevel(key)
    if (serverLevel <= playerLevel) {
      paddingServers = Math.max(key.length, paddingServers)

      paddingLevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddingLevels)
    }
  }

  const items: [string, number][] = []
  for (const key of knownServers) {
    items.push([key, ns.getServerRequiredHackingLevel(key)])
  }

  items.sort(function (first, second) {
    return first[1] - second[1]
  })

  for (const [serverName, serverLevel] of items) {
    const player = ns.getPlayer()
    let numPortsOpen = 0
    if (ns.fileExists("BruteSSH.exe", "home")) {
      ns.brutessh(serverName)
      ++numPortsOpen
    }
    if (ns.fileExists("FTPCrack.exe", "home")) {
      ns.ftpcrack(serverName)
      ++numPortsOpen
    }
    if (ns.fileExists("relaySMTP.exe", "home")) {
      ns.relaysmtp(serverName)
      ++numPortsOpen
    }
    if (ns.fileExists("HTTPWorm.exe", "home")) {
      ns.httpworm(serverName)
      ++numPortsOpen
    }
    if (ns.fileExists("SQLInject.exe", "home")) {
      ns.sqlinject(serverName)
      ++numPortsOpen
    }
    if (
      ns.fileExists("NUKE.exe", "home") &&
      serverLevel <= player.skills.hacking &&
      ns.getServerNumPortsRequired(serverName) <= numPortsOpen
    ) {
      // ns.tprint(
      //   "server: " +
      //     server.padEnd(paddingServers, " ") +
      //     "    level: " +
      //     String(level).padStart(paddingLevels, " ") +
      //     " <= " +
      //     player.skills.hacking +
      //     "    ports: " +
      //     ns.getServerNumPortsRequired(server) +
      //     " <= " +
      //     numPortsOpen
      // )
      // ns.tprint(
      //   server +
      //     "\t level " +
      //     level +
      //     " is lower than player hacking level of " +
      //     player.skills.hacking +
      //     ", executing nuke"
      // )
      const server = ns.getServer(serverName)
      if (!server.hasAdminRights) {
        ns.nuke(serverName)
        ns.tprint(`Nuked ${serverName}`)
      }
      // and servername does not start with "node"

      const BACKDOOR_SERVERS = [
        "CSEC",
        "avmnite-02h",
        "I.I.I.I",
        "run4theh111z",
        "The-Cave",
        "w0r1d_d43m0n",
        "fulcrumassets",
        "megacorp",
      ]

      if (
        !server.backdoorInstalled &&
        !serverName.match("home") &&
        !serverName.startsWith("node") &&
        (BACKDOOR_SERVERS.includes(serverName) || backdoorAll)
      ) {
        connect(ns, serverName)
        await ns.singularity.installBackdoor()
        ns.tprint(`Installed backdoor on ${serverName}`)
      }
    }
  }

  // ns.tprint(items)
  connect(ns, "home")
}
