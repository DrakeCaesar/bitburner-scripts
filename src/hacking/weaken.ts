import { NS } from "@ns"
export async function main(ns: NS) {
  // First argument: delay (ms), Second argument: target.
  const delay = Number(ns.args[0])
  const target = ns.args[1]
  await ns.sleep(delay)
  await ns.weaken(target as string)
}
