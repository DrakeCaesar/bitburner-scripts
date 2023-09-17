/** @param {import("../..").NS } ns
 * Execute weaken immediately. */
export async function main(ns) {
  ns.disableLog("ALL")
  await ns.weaken(ns.args[0])
}
