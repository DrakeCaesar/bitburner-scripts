import { NS } from "@ns"

// Workers are copied to other hosts without their imports, so the stock-influence check is inline.
// Port and message format: libraries/ports.ts STOCK_INFLUENCE_PORT, libraries/stock/influence.ts.
// Grow helps a company we are long on, hack one we are short on.
function stockFlag(ns: NS, host: string, op: "hack" | "grow"): boolean {
  const message = ns.peek(31)
  if (typeof message !== "string" || message === "NULL PORT DATA") return false
  try {
    return (JSON.parse(message) as Record<string, string>)[host] === (op === "grow" ? "long" : "short")
  } catch {
    return false
  }
}

/** Continuous hack/grow/weaken loop for XP grinding. Args: target, op (hack|grow|weaken), initialDelayMs */
export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string
  const op = String(ns.args[1] ?? "weaken")
  let delayMs = ns.args[2] != null ? Number(ns.args[2]) : 0

  while (true) {
    const options = delayMs > 0 ? { additionalMsec: delayMs } : {}
    if (op === "hack") {
      await ns.hack(target, { ...options, stock: stockFlag(ns, target, "hack") })
    } else if (op === "grow") {
      await ns.grow(target, { ...options, stock: stockFlag(ns, target, "grow") })
    } else {
      await ns.weaken(target, options)
    }
    delayMs = 0
  }
}
