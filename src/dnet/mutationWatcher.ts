import { NS } from "@ns"
import { MUTATION_PORT } from "./constants.js"

/** Home watcher: posts the latest darknet mutation timestamp to MUTATION_PORT. */
export async function main(ns: NS): Promise<void> {
  const dnet = (ns as NS & { dnet?: { nextMutation(): Promise<void> } }).dnet
  if (!dnet?.nextMutation) {
    ns.print("mutationWatcher: dnet.nextMutation unavailable")
    return
  }

  ns.clearPort(MUTATION_PORT)
  let first = true

  for (;;) {
    await dnet.nextMutation()
    ns.writePort(MUTATION_PORT, String(Date.now()))
    if (!first) ns.readPort(MUTATION_PORT)
    first = false
  }
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
