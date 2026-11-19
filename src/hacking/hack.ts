import { NS } from "@ns"

// Workers are copied to other hosts without their imports, so the stock-influence check is inline.
// Port and message format: libraries/ports.ts STOCK_INFLUENCE_PORT, libraries/stock/influence.ts.
function stockFlag(ns: NS, host: string): boolean {
  const message = ns.peek(31)
  if (typeof message !== "string" || message === "NULL PORT DATA") return false
  try {
    return (JSON.parse(message) as Record<string, string>)[host] === "short"
  } catch {
    return false
  }
}

export async function main(ns: NS) {
  const target = ns.args[0] as string
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const stolen = await ns.hack(target, { additionalMsec: delay, stock: stockFlag(ns, target) })

  const reportPort = ns.args.length >= 6 ? Number(ns.args[5]) : 0
  if (Number.isInteger(reportPort) && reportPort > 0) {
    ns.writePort(reportPort, stolen)
  }
}
