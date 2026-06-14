import { NS } from "@ns"

/** Servers that appear in ns.scan() but cannot use normal hacking APIs. */
export function isHackableNetworkServer(hostname: string): boolean {
  return !hostname.startsWith("hacknet") && !isDarknetServer(hostname)
}

/** Entry and darknet hosts that reject getServerRequiredHackingLevel and related APIs. */
export function isDarknetServer(hostname: string): boolean {
  return hostname === "darkweb"
}

export function crawl(ns: NS, knownServers = new Set<string>(), hostname = ns.getHostname(), depth = 0): Array<string> {
  ns.scan(hostname).forEach((element) => {
    if (!isHackableNetworkServer(element) || knownServers.has(element)) return
    knownServers.add(element)
    crawl(ns, knownServers, element, depth + 1)
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
