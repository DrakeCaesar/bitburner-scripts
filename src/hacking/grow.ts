import { NS } from "@ns"
// import { logActualBatchOp } from "/src/batchVisualizerStub.js"

export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const operationId = ns.args[2] ? Number(ns.args[2]) : 0
  const expectedHackLevel = ns.args[3] !== undefined ? Number(ns.args[3]) : undefined
  const expectedHackXp = ns.args[4] !== undefined ? Number(ns.args[4]) : undefined
  const start = Date.now()
  await ns.grow(target as string, { additionalMsec: delay })
  const end = Date.now()
  // logActualBatchOp("G", start, end, operationId)

  // Validate expected hacking level and XP if provided
  if (expectedHackLevel !== undefined || expectedHackXp !== undefined) {
    const player = ns.getPlayer()
    const actualHackLevel = player.skills.hacking
    const actualHackXp = player.exp.hacking

    if (expectedHackLevel !== undefined && actualHackLevel !== expectedHackLevel) {
      ns.tprint(
        `GROW ${target}: Level mismatch! Expected: ${expectedHackLevel}, Actual: ${actualHackLevel}, Diff: ${actualHackLevel - expectedHackLevel}`
      )
    }

    if (expectedHackXp !== undefined) {
      const xpDiff = Math.abs(actualHackXp - expectedHackXp)
      if (xpDiff > 0.001) {
        ns.tprint(
          `GROW ${target}: XP mismatch! Expected: ${expectedHackXp.toFixed(2)}, Actual: ${actualHackXp.toFixed(2)}, Diff: ${(actualHackXp - expectedHackXp).toFixed(2)}`
        )
      }
    }
  }

  // Check money percentage after grow
  const currentMoney = ns.getServerMoneyAvailable(target as string)
  const maxMoney = ns.getServerMaxMoney(target as string)
  const moneyPercent = (currentMoney / maxMoney) * 100
  if (moneyPercent < 100) {
    ns.tprint(`WARNING: GROW ${target}: Money at ${moneyPercent.toFixed(2)}%`)
  }
}
