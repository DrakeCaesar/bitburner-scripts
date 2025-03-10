import { NS } from "@ns"
export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const lowestSec = ns.getServerMinSecurityLevel(target as string)
  const currentSec = ns.getServerSecurityLevel(target as string)
  const difference = currentSec - lowestSec
  if (difference != 0) {
    ns.tprint(`Error: Target has security increased by ${difference}`)
  }
  const start = Date.now()
  await ns.hack(target as string, { additionalMsec: delay })
  const end = Date.now()

  ns.tprint(`("H", ${start}, ${end}),`)
}
