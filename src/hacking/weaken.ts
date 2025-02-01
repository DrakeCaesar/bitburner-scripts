import { NS } from "@ns"
export async function main(ns: NS) {
  const target = ns.args[0] // First parameter: target server.
  const delay = ns.args[1] ? Number(ns.args[1]) : 0 // Second parameter (optional): delay in ms.
  await ns.sleep(delay)
  await ns.weaken(target as string)
}
