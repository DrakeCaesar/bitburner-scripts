/** @param {import("..").NS } ns */
export function main(ns) {
   let knownServers = []
   crawl(ns, knownServers)
   ns.tprint("servers: " + knownServers.length)
   ns.tprint(knownServers)
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownServers, hostname, depth = 0) {
   let servers = ns.scan(hostname)
   for (const element of servers) {
      if (!knownServers.includes(element)) {
         knownServers.push(element)
         crawl(ns, knownServers, element, depth + 1)
      }
   }
}
