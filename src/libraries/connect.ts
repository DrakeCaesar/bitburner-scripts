import { NS } from "@ns"

export function connect(
  ns: NS,
  target: string,
  visited = new Set<string>(),
  queue: { node: string; path: string[] }[] = [
    { node: ns.getHostname(), path: [] },
  ]
): void {
  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { node, path } = queue.shift()!

    if (node.startsWith(target)) {
      for (const iterator of [...path, node]) {
        ns.singularity.connect(iterator)
      }
      return
    }

    if (!visited.has(node)) {
      visited.add(node)
      const neighbors = ns.scan(node)

      for (const neighbor of neighbors) {
        queue.push({ node: neighbor, path: [...path, node] })
      }
    }
  }

  ns.tprint("Target not found")
}
