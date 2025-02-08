import { NS } from "@ns"
export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  await ns.sleep(delay)
  const lowestSec = ns.getServerMinSecurityLevel(target as string)
  const currentSec = ns.getServerSecurityLevel(target as string)
  const difference = currentSec - lowestSec
  if (difference != 0) {
    ns.tprint(`Error: Target has security increased by ${difference}`)
  }
  await ns.hack(target as string)
}
