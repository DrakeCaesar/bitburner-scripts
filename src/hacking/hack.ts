import { NS } from "@ns"
// import { logActualBatchOp } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0
  const expectedHackLevel = ns.args[3] ? Number(ns.args[3]) : undefined

  const start = Date.now()
  await ns.hack(target as string, { additionalMsec: delay })
  const end = Date.now()

  // Validate expected hacking level if provided
  if (expectedHackLevel !== undefined) {
    const actualHackLevel = ns.getPlayer().skills.hacking
    if (actualHackLevel !== expectedHackLevel) {
      ns.tprint(
        `HACK ${target}: Level mismatch! Expected: ${expectedHackLevel}, Actual: ${actualHackLevel}, Diff: ${actualHackLevel - expectedHackLevel}`
      )
    }
  }

  // logActualBatchOp("H", start, end, operationId)
}
