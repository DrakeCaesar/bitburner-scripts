import { NS } from "@ns"

const DARKWEB = "darkweb"

function bfsConnect(ns: NS, target: string): boolean {
  const visited = new Set<string>()
  const queue: { node: string; path: string[] }[] = [{ node: ns.getHostname(), path: [] }]

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { node, path } = queue.shift()!

    if (node.startsWith(target)) {
      for (const hop of [...path, node]) {
        ns.singularity.connect(hop)
      }
      return true
    }

    if (!visited.has(node)) {
      visited.add(node)
      for (const neighbor of ns.scan(node)) {
        queue.push({ node: neighbor, path: [...path, node] })
      }
    }
  }

  return false
}

export function connect(ns: NS, target: string): void {
  const trimmed = target.trim()
  if (!trimmed) {
    ns.tprint("Target not found")
    return
  }

  if (DARKWEB.startsWith(trimmed)) {
    if (!ns.hasTorRouter()) {
      ns.tprint("Need TOR router to connect to darkweb")
      return
    }
    if (ns.getHostname() !== "home" && !bfsConnect(ns, "home")) {
      ns.tprint("Target not found")
      return
    }
    ns.singularity.connect(DARKWEB)
    return
  }

  if (!bfsConnect(ns, trimmed)) {
    ns.tprint("Target not found")
  }
}
