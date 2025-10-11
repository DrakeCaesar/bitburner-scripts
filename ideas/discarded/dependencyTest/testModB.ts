import { NS } from "@ns"
import { testa } from "./testModA"

export function testB(ns: NS) {
  ns.bladeburner.getActionCurrentLevel("General", "Training")

  testa(ns)
}
