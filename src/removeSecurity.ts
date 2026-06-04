import { NS } from "@ns"
import {
  REMOVE_SECURITY_LAYOUT,
  WEAKEN_SCRIPT,
  buildRemoveSecurityLog,
  collectRemoveSecurityState,
  launchPendingWeakenJobs,
  refreshKnownHosts,
} from "./libraries/removeSecurity.js"
import { initScriptLogTail } from "./libraries/scriptLogUi.js"

const LOOP_INTERVAL_MS = 1_000

export async function main(ns: NS): Promise<void> {
  const execHost = (ns.args[0] as string) || "home"
  ns.scp(WEAKEN_SCRIPT, execHost)

  const knownHosts = new Set<string>()
  refreshKnownHosts(ns, knownHosts)

  initScriptLogTail(ns, `Remove Security (${execHost})`, REMOVE_SECURITY_LAYOUT)

  while (true) {
    refreshKnownHosts(ns, knownHosts)
    const state = collectRemoveSecurityState(ns, execHost, knownHosts)
    launchPendingWeakenJobs(ns, execHost, state)
    const stateAfter = collectRemoveSecurityState(ns, execHost, knownHosts)
    await buildRemoveSecurityLog(ns, stateAfter).render(ns)
    await ns.sleep(LOOP_INTERVAL_MS)
  }
}
