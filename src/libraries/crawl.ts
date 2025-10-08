import { NS } from "@ns"

export function crawl(ns: NS, knownServers = new Set<string>(), hostname = ns.getHostname(), depth = 0): Array<string> {
  ns.scan(hostname).forEach((element) => {
    if (!knownServers.has(element)) {
      knownServers.add(element)
      crawl(ns, knownServers, element, depth + 1)
    }
  })
  if (depth == 0) {
    return Array.from(knownServers).sort()
  }
  return new Array<string>()
}

export async function main(ns: NS): Promise<void> {
  const knownServers = new Set<string>()
  crawl(ns, knownServers)
  const sortedServers = Array.from(knownServers).sort()
  ns.tprint(`servers: ${sortedServers.length}`)
  ns.tprint(sortedServers)
}
