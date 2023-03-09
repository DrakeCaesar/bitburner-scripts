/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { NS } from "@ns"

function crawl(
   ns: NS,
   knownServers: Set<string>,
   hostname = ns.getHostname(),
   depth = 0
): void {
   ns.scan(hostname).forEach((element) => {
      if (!knownServers.has(element)) {
         knownServers.add(element)
         crawl(ns, knownServers, element, depth + 1)
      }
   })
}

function crawlFast(
   ns: NS,
   knownServers: Set<string>,
   startNode = ns.getHostname()
): void {
   const queue = [startNode]
   const visited = new Set()

   while (queue.length > 0) {
      const currentNode = queue.shift()!

      if (!knownServers.has(currentNode)) {
         knownServers.add(currentNode)
      }

      visited.add(currentNode)

      const neighbors = ns.scan(currentNode)
      for (const neighbor of neighbors) {
         if (!visited.has(neighbor)) {
            queue.push(neighbor)
            visited.add(neighbor)
         }
      }
   }
}

export function crawlOld(
   ns: NS,
   knownServersOld: string[],
   hostname = "",
   depth = 0
) {
   const servers = ns.scan(hostname)
   for (const element of servers) {
      if (!knownServersOld.includes(element)) {
         knownServersOld.push(element)
         crawlOld(ns, knownServersOld, element, depth + 1)
      }
   }
}

export async function main(ns: NS): Promise<void> {
   const knownServers = new Set<string>()
   crawl(ns, knownServers)
   const sortedServers = Array.from(knownServers).sort()
   ns.tprint(`servers: ${sortedServers.length}`)
   ns.tprint(sortedServers)

   knownServers.clear()

   crawlFast(ns, knownServers)
   const sortedServersFast: string[] = Array.from(knownServers).sort()
   ns.tprint(`servers: ${sortedServersFast.length}`)
   ns.tprint(sortedServersFast)

   const knownServersOld: string[] = []
   crawlOld(ns, knownServersOld)
   const sortedServersOld = knownServersOld.sort()
   ns.tprint("servers: " + sortedServersOld.length)
   ns.tprint(sortedServersOld)
}
