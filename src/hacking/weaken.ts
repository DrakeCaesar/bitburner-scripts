import { NS } from "@ns"
import { logActualBatchOperation } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0] // First parameter: target server.
  const delay = ns.args[1] ? Number(ns.args[1]) : 0 // Second parameter (optional): delay in ms.
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0 // Third parameter: operation ID
  const start = Date.now()
  await ns.weaken(target as string, { additionalMsec: delay })
  const end = Date.now()
  logActualBatchOperation("W", start, end, operationId)
}
