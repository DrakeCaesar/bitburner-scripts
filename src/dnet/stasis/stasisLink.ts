import { NS } from "@ns"

/** One-shot script: apply stasis link on the current host and report to the worker reply port. */
export async function main(ns: NS): Promise<void> {
  const replyPort = Number(ns.args[0])
  const hostname = ns.getHostname()
  const dnet = (ns as NS & { dnet?: { setStasisLink?(shouldLink?: boolean): Promise<{ success: boolean }> } }).dnet

  let success = false
  try {
    if (dnet?.setStasisLink) {
      success = (await dnet.setStasisLink(true)).success
    }
  } catch {
    /* stasis may fail */
  }

  if (Number.isFinite(replyPort) && replyPort > 0) {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "stasisResult",
        workerHost: hostname,
        success,
      }),
    )
  }
}
