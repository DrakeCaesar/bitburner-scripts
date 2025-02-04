import { NS } from ".."

const SPINNER_DELAY_MS = 32

export async function main(ns: NS) {
  //
  for (;;) {
    ns.tprint("")
    await ns.sleep(SPINNER_DELAY_MS)
    ns.clearLog()

    ns.tprint("")
    await ns.sleep(SPINNER_DELAY_MS)
    ns.clearLog()

    ns.tprint("")
    await ns.sleep(SPINNER_DELAY_MS)
    ns.clearLog()

    ns.tprint("")
    await ns.sleep(SPINNER_DELAY_MS)
    ns.clearLog()

    ns.tprint("")
    await ns.sleep(SPINNER_DELAY_MS)
    ns.clearLog()

    ns.tprint("")
    await ns.sleep(SPINNER_DELAY_MS)
    ns.clearLog()
  }
}
