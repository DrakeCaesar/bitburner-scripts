import { FactionName, NS } from "@ns"
import { getAugmentCatalog } from "../augmentations.js"
import { crawl } from "../crawl.js"
import type { GoalCheckResult, GoalDefinition } from "./goalTree.js"

export const WORLD_DAEMON_HOST = "w0r1d_d43m0n"
export const RED_PILL_AUGMENT = "The Red Pill"
export const DAEDALUS_FACTION = "Daedalus" as FactionName
export const DAEDALUS_SERVER = "The-Cave"

export function hasRedPillInstalled(ns: NS): boolean {
  return ns.singularity.getOwnedAugmentations(true).includes(RED_PILL_AUGMENT)
}

export function hasRedPillPurchased(ns: NS): boolean {
  return ns.singularity.getOwnedAugmentations(false).includes(RED_PILL_AUGMENT)
}

export function getRedPillFactions(ns: NS): FactionName[] {
  const entry = getAugmentCatalog(ns).get(RED_PILL_AUGMENT)
  return entry?.factions ?? []
}

export function getBestRedPillFactionProgress(ns: NS): {
  faction: FactionName
  rep: number
  repReq: number
} | null {
  const repReq = ns.singularity.getAugmentationRepReq(RED_PILL_AUGMENT)
  const playerFactions = new Set(ns.getPlayer().factions)
  let best: { faction: FactionName; rep: number; repReq: number } | null = null

  for (const faction of getRedPillFactions(ns)) {
    if (!playerFactions.has(faction)) continue
    const rep = ns.singularity.getFactionRep(faction)
    if (best == null || rep > best.rep) {
      best = { faction, rep, repReq }
    }
  }

  return best
}

export function isWorldDaemonOnNetwork(ns: NS): boolean {
  if (!hasRedPillInstalled(ns)) return false
  const known = new Set<string>()
  crawl(ns, known)
  return known.has(WORLD_DAEMON_HOST)
}

export function getWorldDaemonRequiredHack(ns: NS): number | null {
  if (!ns.serverExists(WORLD_DAEMON_HOST)) return null
  try {
    return ns.getServerRequiredHackingLevel(WORLD_DAEMON_HOST)
  } catch {
    return null
  }
}

function formatRep(ns: NS, value: number): string {
  return ns.format.number(value)
}

function checkRedPillFaction(ns: NS): GoalCheckResult {
  const factions = getRedPillFactions(ns)
  const joined = factions.filter((faction) => ns.getPlayer().factions.includes(faction))
  if (joined.length > 0) {
    return { complete: true, detail: `member of ${joined.join(", ")}` }
  }
  return {
    complete: false,
    detail: `join a Red Pill faction (${factions.join(", ") || "unknown"})`,
    blocked: factions.length === 0,
  }
}

function checkRedPillRep(ns: NS): GoalCheckResult {
  const progress = getBestRedPillFactionProgress(ns)
  const repReq = ns.singularity.getAugmentationRepReq(RED_PILL_AUGMENT)
  if (progress == null) {
    return {
      complete: false,
      detail: `need ${formatRep(ns, repReq)} rep with a Red Pill faction`,
      blocked: true,
    }
  }
  if (progress.rep >= repReq) {
    return {
      complete: true,
      detail: `${progress.faction} ${formatRep(ns, progress.rep)} / ${formatRep(ns, repReq)}`,
    }
  }
  return {
    complete: false,
    detail: `${progress.faction} ${formatRep(ns, progress.rep)} / ${formatRep(ns, repReq)}`,
  }
}

function checkRedPillPurchased(ns: NS): GoalCheckResult {
  if (hasRedPillPurchased(ns)) {
    return { complete: true, detail: "owned (installed or queued)" }
  }
  const progress = getBestRedPillFactionProgress(ns)
  const repReq = ns.singularity.getAugmentationRepReq(RED_PILL_AUGMENT)
  if (progress != null && progress.rep >= repReq) {
    return { complete: false, detail: "purchase The Red Pill" }
  }
  return { complete: false, detail: "purchase after faction rep is met" }
}

function checkRedPillInstalled(ns: NS): GoalCheckResult {
  if (hasRedPillInstalled(ns)) {
    return { complete: true, detail: "installed" }
  }
  if (hasRedPillPurchased(ns)) {
    return { complete: false, detail: "queued — install augmentations" }
  }
  return { complete: false, detail: "not owned" }
}

function checkWorldDaemonReachable(ns: NS): GoalCheckResult {
  if (!hasRedPillInstalled(ns)) {
    return { complete: false, detail: "requires The Red Pill installed", blocked: true }
  }
  if (isWorldDaemonOnNetwork(ns)) {
    return { complete: true, detail: `${WORLD_DAEMON_HOST} on network` }
  }
  return { complete: false, detail: `scan from ${DAEDALUS_SERVER} for ${WORLD_DAEMON_HOST}` }
}

function checkWorldDaemonHackLevel(ns: NS): GoalCheckResult {
  const required = getWorldDaemonRequiredHack(ns)
  const current = ns.getPlayer().skills.hacking
  if (required == null) {
    return { complete: false, detail: "world daemon level unknown", blocked: !hasRedPillInstalled(ns) }
  }
  if (current >= required) {
    return { complete: true, detail: `${current} / ${required}` }
  }
  return { complete: false, detail: `${current} / ${required}` }
}

function checkWorldDaemonRoot(ns: NS): GoalCheckResult {
  if (!ns.serverExists(WORLD_DAEMON_HOST)) {
    return { complete: false, detail: "server not known yet", blocked: !hasRedPillInstalled(ns) }
  }
  if (ns.hasRootAccess(WORLD_DAEMON_HOST)) {
    return { complete: true, detail: "root access" }
  }
  const ports = ns.getServerNumPortsRequired(WORLD_DAEMON_HOST)
  return { complete: false, detail: `nuke (${ports} ports required)` }
}

// function checkWorldDaemonBackdoor(ns: NS): GoalCheckResult {
//   if (!ns.serverExists(WORLD_DAEMON_HOST)) {
//     return { complete: false, detail: "server not known yet", blocked: true }
//   }
//   if (ns.getServer(WORLD_DAEMON_HOST).backdoorInstalled) {
//     return { complete: true, detail: "backdoor installed" }
//   }
//   return { complete: false, detail: "connect and run backdoor" }
// }

/**
 * Top-level run goal: reach w0r1d_d43m0n (backdoor step disabled for now).
 *
 * Singularity-backed background work (faction rep, gym, megacorp) must be started
 * before infiltration DOM automation — infiltration blocks focused UI but prior work
 * keeps running. Future orchestrator stops will reuse autoInfiltration patterns.
 */
export function getWorldDaemonBackdoorGoal(): GoalDefinition {
  return {
    id: "world-daemon-backdoor",
    label: "Reach World Daemon",
    children: [
      {
        id: "red-pill",
        label: "The Red Pill",
        children: [
          {
            id: "red-pill-faction",
            label: "Red Pill faction joined",
            check: checkRedPillFaction,
          },
          {
            id: "red-pill-rep",
            label: "Red Pill faction rep",
            check: checkRedPillRep,
          },
          {
            id: "red-pill-purchased",
            label: "Red Pill purchased",
            check: checkRedPillPurchased,
          },
          {
            id: "red-pill-installed",
            label: "Red Pill installed",
            check: checkRedPillInstalled,
          },
        ],
      },
      {
        id: "world-daemon-reachable",
        label: "World Daemon reachable",
        check: checkWorldDaemonReachable,
      },
      {
        id: "world-daemon-hack-level",
        label: "World Daemon hacking level",
        check: checkWorldDaemonHackLevel,
      },
      {
        id: "world-daemon-root",
        label: "World Daemon root access",
        check: checkWorldDaemonRoot,
      },
      // {
      //   id: "world-daemon-backdoor-installed",
      //   label: "Install backdoor on World Daemon",
      //   check: checkWorldDaemonBackdoor,
      // },
    ],
  }
}
