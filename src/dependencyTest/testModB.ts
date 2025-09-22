import { NS } from "@ns"
import { testa } from "/src/dependencyTest/testModA.js"

export function testB(ns: NS) {
  ns.bladeburner.getActionCurrentLevel("General", "Training")

  testa(ns)
}
