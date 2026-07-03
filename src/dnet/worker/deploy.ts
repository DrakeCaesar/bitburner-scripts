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

/** Human-readable reason when ns.exec fails to start the worker script. */
export function describeWorkerExecFailure(ns: NS, host: string, script: string): string {
  if (!ns.fileExists(script, host)) {
    return `${script} missing on ${host}`
  }
  let ram = 0
  try {
    ram = ns.getScriptRam(script, host)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `cannot calculate RAM for ${script} on ${host}: ${msg}`
  }
  if (ram <= 0) {
    return `worker RAM is 0 on ${host} (is ${script} present on home?)`
  }
  try {
    const maxRam = ns.getServerMaxRam(host)
    const usedRam = ns.getServerUsedRam(host)
    const freeRam = maxRam - usedRam
    if (freeRam < ram) {
      return `insufficient RAM on ${host} (need ${ram.toFixed(2)}GB, ${freeRam.toFixed(2)}GB free)`
    }
  } catch {
    /* host stats unavailable */
  }
  return `ns.exec returned 0 (${script} needs ${ram.toFixed(2)}GB on ${host})`
}
