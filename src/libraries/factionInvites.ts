import { FactionName, NS } from "@ns"

function factionAugmentsOwned(ns: NS, faction: FactionName): boolean {
  const owned = new Set(ns.singularity.getOwnedAugmentations(true))
  for (const aug of ns.singularity.getAugmentationsFromFaction(faction)) {
    if (aug.startsWith("NeuroFlux Governor")) continue
    if (!owned.has(aug)) return false
  }
  return true
}

function isEnemyOf(ns: NS, faction: FactionName, other: FactionName): boolean {
  return ns.singularity.getFactionEnemies(faction).includes(other)
}

export interface FactionInvitationStatus {
  eligible: boolean
  reason: string
}

export function getFactionInvitationStatus(
  ns: NS,
  faction: FactionName,
  currentFactions: readonly FactionName[],
  pendingInvitations: readonly FactionName[]
): FactionInvitationStatus {
  if (currentFactions.includes(faction)) {
    return { eligible: false, reason: "Already a member" }
  }
  if (factionAugmentsOwned(ns, faction)) {
    return { eligible: false, reason: "All augmentations owned" }
  }

  for (const member of currentFactions) {
    if (isEnemyOf(ns, faction, member)) {
      return { eligible: false, reason: `Enemy of current faction: ${member}` }
    }
  }

  for (const invite of pendingInvitations) {
    if (invite === faction) continue
    if (!isEnemyOf(ns, faction, invite)) continue
    if (!factionAugmentsOwned(ns, invite)) {
      return { eligible: false, reason: `Would block pending invite with augments left: ${invite}` }
    }
  }

  return { eligible: true, reason: "OK to join" }
}

/** Whether accepting this invite would block a faction we still need augments from. */
export function shouldJoinFactionInvitation(
  ns: NS,
  faction: FactionName,
  currentFactions: readonly FactionName[],
  pendingInvitations: readonly FactionName[]
): boolean {
  return getFactionInvitationStatus(ns, faction, currentFactions, pendingInvitations).eligible
}

export function joinWorthyFactionInvitations(ns: NS): FactionName[] {
  const player = ns.getPlayer()
  const invitations = ns.singularity.checkFactionInvitations()
  const joined: FactionName[] = []

  for (const faction of invitations) {
    if (!shouldJoinFactionInvitation(ns, faction, player.factions, invitations)) continue
    if (ns.singularity.joinFaction(faction)) joined.push(faction)
  }

  return joined
}
