import { NS } from "@ns"
import { testa } from "/src/dependencyTest/testModA"

export function testB(ns: NS) {
  ns.bladeburner.getActionCountRemaining("", "")
  testa(ns)
}
