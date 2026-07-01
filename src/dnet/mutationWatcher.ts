import { NS } from "@ns"
import { MUTATION_PORT } from "./constants.js"

function clock(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Home watcher: posts the latest darknet mutation timestamp to MUTATION_PORT. */
export async function main(ns: NS): Promise<void> {
  const dnet = (ns as NS & { dnet?: { nextMutation(): Promise<void> } }).dnet
  if (!dnet?.nextMutation) {
    ns.print("mutationWatcher: dnet.nextMutation unavailable")
    return
  }

  ns.clearPort(MUTATION_PORT)
  ns.print(`mutationWatcher started port ${MUTATION_PORT} ${clock()}`)

  for (;;) {
    await dnet.nextMutation()
    const ts = Date.now()
    ns.clearPort(MUTATION_PORT)
    ns.writePort(MUTATION_PORT, String(ts))
    ns.print(`${clock()}  mutation ts ${ts}`)
  }
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
