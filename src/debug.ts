import { NS } from "@ns"

const logBase = (b: number, n: number) => Math.log(n) / Math.log(b)

export async function main(ns: NS): Promise<void> {
  // const jobs = Object.values(ns.enums.JobField) as JobField[]
  // for (const job of jobs) {
  //   ns.tprint(`JobField: ${job}`)
  // }

  // const agent = ns.enums.JobField.agent
  // ns.tprint(`Agent: ${agent}`)

  for (let i = 0; i <= 20; i++) {
    const maxRam = ns.getPurchasedServerMaxRam()
    const minCost = ns.getPurchasedServerCost(1)
    const maxCost = ns.getPurchasedServerCost(maxRam)

    const targetRam = Math.pow(2, i)
    const targetRamString = targetRam.toString().padEnd(maxRam.toString().length)

    const cost = Math.round(ns.getPurchasedServerCost(targetRam))
    const costString = cost.toString().padEnd(maxCost.toString().length)

    let ratio = cost / targetRam / minCost
    const base = 1.3
    let factor = Math.round(logBase(base, ratio))
    // ratio = ratio / Math.pow(base, factor)
    // ratio = factor

    ns.tprint(`${targetRamString} ${costString} ${base}^${factor}`)
  }
}
