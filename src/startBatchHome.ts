import { NS } from "@ns"

/** Post-augment-install callback: start batch on home workers only. */
export async function main(ns: NS): Promise<void> {
  if (ns.scriptRunning("batch.js", "home")) return
  ns.run("batch.js", 1, "home")
}
