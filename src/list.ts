import { NS } from "@ns"
import { crawl } from "./libraries/crawl"

export function main(ns: NS) {
   const knownServers = crawl(ns)
   let paddingServers = 0
   let paddinglevels = 0
   for (const key of knownServers) {
      paddingServers = Math.max(key.length, paddingServers)

      paddinglevels = Math.max(
         String(ns.getServerRequiredHackingLevel(key)).length,
         paddinglevels
      )
   }

   let items = new Map<string, number>()
   for (const key of knownServers) {
      if (!key.includes("node")) {
         items.set(key, ns.getServerRequiredHackingLevel(key))
      }
   }

   items = new Map(
      [...items].sort(function (first, second) {
         return first[1] - second[1]
      })
   )

   for (const [target, level] of items) {
      const player = ns.getPlayer()
      const server = ns.getServer(target)
      ns.tprint(
         target.padEnd(paddingServers, " ") +
            "    LVL: " +
            String(level).padStart(paddinglevels, " ") +
            (level <= player.skills.hacking ? " <= " : " >> ") +
            player.skills.hacking +
            (server.hasAdminRights ? "  ROOT" : "      ") +
            "  SEC: " +
            (server.hackDifficulty - server.minDifficulty)
               .toFixed(2)
               .padStart(8) +
            "  MEM: " +
            String(server.maxRam).padEnd(8) +
            "    MON: " +
            String(Math.floor(server.moneyMax)).padStart(20) +
            "    TIM: " +
            ns.tFormat(ns.getWeakenTime(target)).padEnd(30)
      )
      let numPortsOpen = 0
      if (ns.fileExists("BruteSSH.exe", "home")) {
         ns.brutessh(target)
         ++numPortsOpen
      }
      if (ns.fileExists("FTPCrack.exe", "home")) {
         ns.ftpcrack(target)
         ++numPortsOpen
      }
      if (ns.fileExists("relaySMTP.exe", "home")) {
         ns.relaysmtp(target)
         ++numPortsOpen
      }
      if (ns.fileExists("HTTPWorm.exe", "home")) {
         ns.httpworm(target)
         ++numPortsOpen
      }
      if (ns.fileExists("SQLInject.exe", "home")) {
         ns.sqlinject(target)
         ++numPortsOpen
      }
      if (
         ns.fileExists("NUKE.exe", "home") &&
         level <= player.skills.hacking &&
         ns.getServerNumPortsRequired(target) <= numPortsOpen
      ) {
         ns.nuke(target)
      }
   }

   //ns.tprint(items);
}
