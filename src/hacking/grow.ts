import { NS } from "@ns"
import { logActualBatchOp } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0
  const start = Date.now()
  await ns.grow(target as string, { additionalMsec: delay })
  const end = Date.now()
  logActualBatchOp("G", start, end, operationId)

  // Check money percentage after grow
  const currentMoney = ns.getServerMoneyAvailable(target as string)
  const maxMoney = ns.getServerMaxMoney(target as string)
  const moneyPercent = (currentMoney / maxMoney) * 100
  if (moneyPercent < 100) {
    ns.tprint(`WARNING: GROW ${target}: Money at ${moneyPercent.toFixed(2)}%`)
  }
}
