import { NS } from "@ns"

/** Continuous hack/grow/weaken loop for XP grinding. Args: target, op (hack|grow|weaken), initialDelayMs */
export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string
  const op = String(ns.args[1] ?? "weaken")
  let delayMs = ns.args[2] != null ? Number(ns.args[2]) : 0

  while (true) {
    const options = delayMs > 0 ? { additionalMsec: delayMs } : {}
    if (op === "hack") {
      await ns.hack(target, options)
    } else if (op === "grow") {
      await ns.grow(target, options)
    } else {
      await ns.weaken(target, options)
    }
    delayMs = 0
  }
}
