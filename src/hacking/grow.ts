import { NS } from "@ns"
export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const start = Date.now()
  await ns.grow(target as string, { additionalMsec: delay })
  const end = Date.now()
  ns.tprint(`("G", ${start}, ${end}),`)
}
