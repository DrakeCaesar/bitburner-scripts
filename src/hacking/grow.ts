import { NS } from "@ns"
import { logActualBatchOperation } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0
  const start = Date.now()
  await ns.grow(target as string, { additionalMsec: delay })
  const end = Date.now()
  logActualBatchOperation("G", start, end, operationId)
}
