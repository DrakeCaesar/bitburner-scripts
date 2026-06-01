import { NS } from "@ns"
export async function main(ns: NS) {
  let maxRam = ns.cloud.getRamLimit()
  ns.tprint("Server Costs:")

  for (let ram = 2; ram <= maxRam; ram *= 2) {
    let cost = ns.cloud.getServerCost(ram)
    ns.tprint(`${ram} GB: ${ns.format.number(cost)} (${cost})`)
  }
}
