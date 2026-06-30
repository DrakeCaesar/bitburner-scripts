import { NS } from "@ns"
import { WORKER_SCRIPT, WORKER_SCP_FILES } from "./constants.js"

/** Copy the full worker bundle to target; verifies every file landed. Null = ok. */
export async function copyWorkerFiles(
  ns: NS,
  target: string,
  source: string,
): Promise<string | null> {
  try {
    ns.scriptKill(WORKER_SCRIPT, target)
  } catch {
    /* no worker running */
  }

  for (const file of WORKER_SCP_FILES) {
    if (!ns.fileExists(file, source)) {
      return `missing on ${source}: ${file}`
    }

    let copied = false
    for (let retry = 0; retry < 3; retry++) {
      if (ns.scp(file, target, source)) {
        copied = true
        break
      }
      await ns.sleep(200)
    }
    if (!copied) {
      return `scp rejected: ${file}`
    }
    if (!ns.fileExists(file, target)) {
      return `missing on ${target} after scp: ${file}`
    }
  }

  return null
}
