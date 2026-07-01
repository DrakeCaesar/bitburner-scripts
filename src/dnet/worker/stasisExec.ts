import { NS } from "@ns"
import type { WorkerDnetApi } from "./dnetApi.js"
import { STASIS_RAM_GB } from "./constants.js"
import { measureHostRam, runReallocUntil } from "./realloc.js"

/** Runtime path — not a static import of the stasis stub (keeps setStasisLink out of worker RAM). */
function stasisScriptPath(): string {
  return ["dnet", "stasis", "stasisLink.js"].join("/")
}

async function copyStasisScript(ns: NS, target: string, source = "home"): Promise<boolean> {
  const script = stasisScriptPath()
  if (ns.fileExists(script, target)) return true
  if (!ns.fileExists(script, source)) return false
  for (let retry = 0; retry < 3; retry++) {
    if (ns.scp(script, target, source)) {
      if (ns.fileExists(script, target)) return true
    }
    await ns.sleep(200)
  }
  return false
}

export async function runStasisCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()

  const writeResult = (success: boolean, message?: string): void => {
    const payload: { type: "stasisResult"; workerHost: string; success: boolean; message?: string } = {
      type: "stasisResult",
      workerHost,
      success,
    }
    if (message) payload.message = message
    ns.writePort(replyPort, JSON.stringify(payload))
  }

  try {
    if (!dnet.getServerDetails(workerHost).hasSession) {
      writeResult(false, "no session on host")
      return
    }

    if (dnet.memoryReallocation) {
      await runReallocUntil(ns, dnet, workerHost, 2)
    }

    if (!(await copyStasisScript(ns, workerHost))) {
      writeResult(false, "stasis script missing")
      return
    }

    const { freeRam } = measureHostRam(ns, dnet, workerHost)
    if (freeRam < STASIS_RAM_GB) {
      writeResult(false, `need ${STASIS_RAM_GB}GB free, have ${freeRam.toFixed(1)}GB`)
      return
    }

    const childPid = ns.exec(stasisScriptPath(), workerHost, 1, replyPort)
    if (childPid <= 0) {
      writeResult(false, "stasis exec failed")
      return
    }

    while (ns.isRunning(childPid)) {
      await ns.sleep(200)
    }
  } catch (err) {
    writeResult(false, err instanceof Error ? err.message : "stasis error")
  }
}
