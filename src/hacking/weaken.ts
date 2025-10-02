import { NS } from "@ns"
// import { logActualBatchOp } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0] // First parameter: target server.
  const delay = ns.args[1] ? Number(ns.args[1]) : 0 // Second parameter (optional): delay in ms.
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0 // Third parameter: operation ID
  const expectedHackLevel = ns.args[3] !== undefined ? Number(ns.args[3]) : undefined // Fourth parameter: expected hacking level
  const expectedHackXp = ns.args[4] !== undefined ? Number(ns.args[4]) : undefined // Fifth parameter: expected hacking XP
  const start = Date.now()
  await ns.weaken(target as string, { additionalMsec: delay })
  const end = Date.now()
  // logActualBatchOp("W", start, end, operationId)

  // Validate expected hacking level and XP if provided
  if (expectedHackLevel !== undefined || expectedHackXp !== undefined) {
    const player = ns.getPlayer()
    const actualHackLevel = player.skills.hacking
    const actualHackXp = player.exp.hacking

    if (expectedHackLevel !== undefined && actualHackLevel !== expectedHackLevel) {
      ns.tprint(
        `WEAKEN ${target}: Level mismatch! Expected: ${expectedHackLevel}, Actual: ${actualHackLevel}, Diff: ${actualHackLevel - expectedHackLevel}`
      )
    }

    if (expectedHackXp !== undefined) {
      const xpDiff = Math.abs(actualHackXp - expectedHackXp)
      if (xpDiff > 0.001) {
        ns.tprint(
          `WEAKEN ${target}: XP mismatch! Expected: ${expectedHackXp.toFixed(2)}, Actual: ${actualHackXp.toFixed(2)}, Diff: ${(actualHackXp - expectedHackXp).toFixed(2)}`
        )
      }
    }
  }

  // Check security after weaken
  const currentSecurity = ns.getServerSecurityLevel(target as string)
  const minSecurity = ns.getServerMinSecurityLevel(target as string)
  if (currentSecurity > minSecurity) {
    ns.tprint(`WARNING: WEAKEN ${target}: Security at ${currentSecurity.toFixed(2)} (min: ${minSecurity})`)
  }
}
