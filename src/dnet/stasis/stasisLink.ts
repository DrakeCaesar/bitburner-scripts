import { NS } from "@ns"

/** One-shot script: apply stasis link on the current host and report to the worker reply port. */
export async function main(ns: NS): Promise<void> {
  const replyPort = Number(ns.args[0])
  const hostname = ns.getHostname()
  const dnet = (ns as NS & {
    dnet?: {
      setStasisLink?(shouldLink?: boolean): Promise<{ success: boolean; message?: string }>
    }
  }).dnet

  let success = false
  let message = "setStasisLink API missing"
  try {
    if (dnet?.setStasisLink) {
      const result = await dnet.setStasisLink(true)
      success = result.success
      if (!success && typeof result.message === "string") {
        message = result.message
      } else if (success) {
        message = ""
      }
    }
  } catch (err) {
    message = err instanceof Error ? err.message : "stasis error"
  }

  if (Number.isFinite(replyPort) && replyPort > 0) {
    const payload: { type: "stasisResult"; workerHost: string; success: boolean; message?: string } = {
      type: "stasisResult",
      workerHost: hostname,
      success,
    }
    if (!success && message) payload.message = message
    ns.writePort(replyPort, JSON.stringify(payload))
  }
}
