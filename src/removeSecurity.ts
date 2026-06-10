import { NS } from "@ns"
import {
  WEAKEN_SCRIPT,
  buildRemoveSecurityLog,
  collectRemoveSecurityState,
  launchPendingWeakenJobs,
  refreshKnownHosts,
} from "./libraries/removeSecurity.js"
import { openTailLog } from "./libraries/scriptLogUiLayout.js"

const LOOP_INTERVAL_MS = 1_000

export async function main(ns: NS): Promise<void> {
  const execHost = (ns.args[0] as string) || "home"
  ns.scp(WEAKEN_SCRIPT, execHost)

  const knownHosts = new Set<string>()
  refreshKnownHosts(ns, knownHosts)

  openTailLog(ns, `Remove Security (${execHost})`)

  while (true) {
    refreshKnownHosts(ns, knownHosts)
    const state = collectRemoveSecurityState(ns, execHost, knownHosts)
    launchPendingWeakenJobs(ns, execHost, state)
    const stateAfter = collectRemoveSecurityState(ns, execHost, knownHosts)
    await buildRemoveSecurityLog(ns, stateAfter).render(ns)
    await ns.sleep(LOOP_INTERVAL_MS)
  }
}
