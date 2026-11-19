import { NS } from "@ns"

// Workers are copied to other hosts without their imports, so the stock-influence check is inline.
// Port and message format: libraries/ports.ts STOCK_INFLUENCE_PORT, libraries/stock/influence.ts.
function stockFlag(ns: NS, host: string): boolean {
  const message = ns.peek(31)
  if (typeof message !== "string" || message === "NULL PORT DATA") return false
  try {
    return (JSON.parse(message) as Record<string, string>)[host] === "long"
  } catch {
    return false
  }
}

export async function main(ns: NS) {
  const target = ns.args[0] as string
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  await ns.grow(target, { additionalMsec: delay, stock: stockFlag(ns, target) })
}
