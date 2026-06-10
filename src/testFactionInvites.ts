import { NS } from "@ns"
import { getFactionInvitationStatus } from "./libraries/factionInvites.js"

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  ns.ui.openTail()
  ns.ui.setTailTitle("Faction invites")

  const player = ns.getPlayer()
  const invitations = ns.singularity.checkFactionInvitations()

  ns.print(`Current factions (${player.factions.length}): ${player.factions.join(", ") || "(none)"}`)
  ns.print(`Pending invitations (${invitations.length}):`)
  ns.print("")

  if (invitations.length === 0) {
    ns.print("No pending invitations.")
    return
  }

  for (const faction of invitations) {
    const { eligible, reason } = getFactionInvitationStatus(ns, faction, player.factions, invitations)
    const label = eligible ? "ELIGIBLE" : "INELIGIBLE"
    ns.print(`${label}  ${faction}`)
    ns.print(`        ${reason}`)

    const enemies = ns.singularity.getFactionEnemies(faction)
    if (enemies.length > 0) {
      ns.print(`        enemies: ${enemies.join(", ")}`)
    }
    ns.print("")
  }
}
