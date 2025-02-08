import { NS } from "@ns"
export async function main(ns: NS) {
  const target = ns.args[0] // First parameter: target server.
  const delay = ns.args[1] ? Number(ns.args[1]) : 0 // Second parameter (optional): delay in ms.
  const start = Date.now()
  await ns.weaken(target as string, { additionalMsec: delay })
  const end = Date.now()
  ns.tprint(`("W", ${start}, ${end}),`)
}
