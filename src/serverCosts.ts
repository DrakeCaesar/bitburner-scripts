import { NS } from "@ns"
export async function main(ns: NS) {
  let maxRam = ns.getPurchasedServerMaxRam()
  ns.tprint("Server Costs:")

  for (let ram = 2; ram <= maxRam; ram *= 2) {
    let cost = ns.getPurchasedServerCost(ram)
    ns.tprint(`${ram} GB: ${ns.nFormat(cost, "($ 0.000 a)")} (${cost})`)
  }
}
