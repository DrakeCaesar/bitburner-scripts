import { FactionName, NS } from "@ns"

/** Mirrors libraries/factionInvites.ts — kept inline so this test script runs even if that file is stale in-game. */
function factionAugmentsOwned(ns: NS, faction: FactionName): boolean {
  const owned = new Set(ns.singularity.getOwnedAugmentations(true))
  for (const aug of ns.singularity.getAugmentationsFromFaction(faction)) {
    if (aug.startsWith("NeuroFlux Governor")) continue
    if (!owned.has(aug)) return false
  }
  return true
}

function getFactionInvitationStatus(
  ns: NS,
  faction: FactionName,
  currentFactions: readonly FactionName[],
  pendingInvitations: readonly FactionName[]
): { eligible: boolean; reason: string } {
  if (currentFactions.includes(faction)) {
    return { eligible: false, reason: "Already a member" }
  }
  if (factionAugmentsOwned(ns, faction)) {
    return { eligible: false, reason: "All augmentations owned" }
  }

  const enemies = ns.singularity.getFactionEnemies(faction)
  for (const member of currentFactions) {
    if (enemies.includes(member)) {
      return { eligible: false, reason: `Enemy of current faction: ${member}` }
    }
  }

  for (const invite of pendingInvitations) {
    if (invite === faction) continue
    if (!enemies.includes(invite)) continue
    if (!factionAugmentsOwned(ns, invite)) {
      return { eligible: false, reason: `Would block pending invite with augments left: ${invite}` }
    }
  }

  return { eligible: true, reason: "OK to join" }
}

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
