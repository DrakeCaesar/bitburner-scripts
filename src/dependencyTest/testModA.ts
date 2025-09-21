import { NS } from "@ns"

export function testa(ns: NS) {
  const playery = ns.getPlayer()

  ns.bladeburner.getActionCurrentLevel("General", "Training")

  ns.bladeburner.getActionCurrentLevel("General", "Training")

  const playerx = ns.getPlayer()
  ns.sleep(1000)

  ns.bladeburner.getActionCurrentLevel("General", "Training")
  ns.sleep(1000)

  const player = ns.getPlayer()
  const moneyMax = ns.getServerMaxMoney("test")
}
