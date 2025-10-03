import { NS } from "@ns"
// import { logActualBatchOp } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0
  const expectedHackLevel = ns.args[3] !== undefined ? Number(ns.args[3]) : undefined
  const expectedHackXp = ns.args[4] !== undefined ? Number(ns.args[4]) : undefined

  const start = Date.now()
  await ns.hack(target as string, { additionalMsec: delay })
  const end = Date.now()

  // Validate expected hacking level and XP if provided
  if (expectedHackLevel !== undefined || expectedHackXp !== undefined) {
    const player = ns.getPlayer()
    const actualHackLevel = player.skills.hacking
    const actualHackXp = player.exp.hacking

    const levelMismatch = expectedHackLevel !== undefined && actualHackLevel !== expectedHackLevel

    if (levelMismatch) {
      ns.tprint(
        `HACK ${target}: Level mismatch! Expected: ${expectedHackLevel}, Actual: ${actualHackLevel}, Diff: ${actualHackLevel - expectedHackLevel}`
      )
    }

    // Only report XP mismatch if there's also a level mismatch (otherwise it's just floating point error)
    if (expectedHackXp !== undefined && levelMismatch) {
      const xpDiff = Math.abs(actualHackXp - expectedHackXp)
      ns.tprint(
        `HACK ${target}: XP mismatch! Expected: ${expectedHackXp.toFixed(2)}, Actual: ${actualHackXp.toFixed(2)}, Diff: ${(actualHackXp - expectedHackXp).toFixed(2)}`
      )
    }
  }

  // logActualBatchOp("H", start, end, operationId)
}
