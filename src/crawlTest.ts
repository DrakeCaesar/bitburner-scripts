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

export async function main(ns: NS): Promise<void> {
  const knownServers = new Set<string>()
  crawl(ns, knownServers)
  const sortedServers = Array.from(knownServers).sort()
  ns.tprint(`servers: ${sortedServers.length}`)
  ns.tprint(sortedServers)

  const doc = 0
}
