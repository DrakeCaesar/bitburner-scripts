import { NS } from ".."

export function main(ns: NS): void {
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

         paddingLevels = Math.max(
            String(ns.getServerRequiredHackingLevel(key)).length,
            paddingLevels
         )
      }
   }

   const items: [string, number][] = []
   for (const key of knownServers) {
      items.push([key, ns.getServerRequiredHackingLevel(key)])
   }

   items.sort(function (first, second) {
      return first[1] - second[1]
   })

   for (const [server, level] of items) {
      const player = ns.getPlayer()
      let numPortsOpen = 0
      if (ns.fileExists("BruteSSH.exe", "home")) {
         ns.brutessh(server)
         ++numPortsOpen
      }
      if (ns.fileExists("FTPCrack.exe", "home")) {
         ns.ftpcrack(server)
         ++numPortsOpen
      }
      if (ns.fileExists("relaySMTP.exe", "home")) {
         ns.relaysmtp(server)
         ++numPortsOpen
      }
      if (ns.fileExists("HTTPWorm.exe", "home")) {
         ns.httpworm(server)
         ++numPortsOpen
      }
      if (ns.fileExists("SQLInject.exe", "home")) {
         ns.sqlinject(server)
         ++numPortsOpen
      }
      if (
         ns.fileExists("NUKE.exe", "home") &&
         level <= player.skills.hacking &&
         ns.getServerNumPortsRequired(server) <= numPortsOpen
      ) {
         /*
            ns.tprint(
                "server: " + 
                server.padEnd(paddingServers,' ') + 
                "    level: " + 
                String(level).padStart(paddingLevels,' ') +
                " <= " + 
                player.hacking +
                "    ports: " +
                ns.getServerNumPortsRequired(server) +
                " <= " + 
                numPortsOpen
                )
            */
         //ns.tprint(server +"\t level" + level + " is lower than player hacking level of " + player.hacking + ", executing nuke")
         ns.nuke(server)
         ns.singularity
      }
   }

   //ns.tprint(items);
}

export function crawl(
   ns: NS,
   knownServers: string[],
   hostname?: string,
   depth = 0
): void {
   const servers: string[] = ns.scan(hostname)
   for (const element of servers) {
      if (!knownServers.includes(element)) {
         knownServers.push(element)
         crawl(ns, knownServers, element, depth + 1)
      }
   }
}
