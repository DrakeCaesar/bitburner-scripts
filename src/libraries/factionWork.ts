import { FactionName, NS } from "@ns"
import type { ReactTableConfig } from "./scriptLogUi.js"

/** Matches in-game BaseFavorToDonate (see bitburner-src Constants.ts). */
const BASE_FAVOR_TO_DONATE = 150

/** Favor required to donate; scales with BitNode via FavorToDonateToFaction (e.g. 150 default, 75 on BN3). */
export function getTargetFavor(ns: NS): number {
  return Math.floor(BASE_FAVOR_TO_DONATE * ns.getBitNodeMultipliers().FavorToDonateToFaction)
}

export interface AugmentTarget {
  augmentName: string
  faction: FactionName
  currentRep: number
  requiredRep: number
  repGap: number
  favor: number
  favorGain: number
  predictedFavor: number
}

export type FactionWorkMode = "favor" | "rep" | "idle"

export interface FactionWorkRow {
  faction: FactionName
  mode: FactionWorkMode
  augmentName: string
  currentRep: number
  requiredRep: number
  repGap: number
  favor: number
  predictedFavor: number
  favorGap: number
  reason: string
  isSelected: boolean
}

export function gatherAugmentTargets(ns: NS, playerFactions: readonly FactionName[]): AugmentTarget[] {
  const ownedAugments = new Set(ns.singularity.getOwnedAugmentations(true))
  const targets: AugmentTarget[] = []
  const augmentsWithEnoughRep = new Set<string>()

  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)
    const currentRep = ns.singularity.getFactionRep(faction)

    for (const augName of augments) {
      if (ownedAugments.has(augName)) continue
      if (augName.startsWith("NeuroFlux Governor")) continue

      const requiredRep = ns.singularity.getAugmentationRepReq(augName)
      if (currentRep >= requiredRep) augmentsWithEnoughRep.add(augName)
    }
  }

  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)
    const currentRep = ns.singularity.getFactionRep(faction)

    for (const augName of augments) {
      if (ownedAugments.has(augName)) continue
      if (augName.startsWith("NeuroFlux Governor")) continue
      if (augmentsWithEnoughRep.has(augName)) continue

      const requiredRep = ns.singularity.getAugmentationRepReq(augName)
      const favor = ns.singularity.getFactionFavor(faction)
      const favorGain = ns.singularity.getFactionFavorGain(faction)
      const predictedFavor = favor + favorGain

      if (currentRep < requiredRep) {
        targets.push({
          augmentName: augName,
          faction,
          currentRep,
          requiredRep,
          repGap: requiredRep - currentRep,
          favor,
          favorGain,
          predictedFavor,
        })
      }
    }
  }

  return targets
}

export function prioritizeTargets(targets: AugmentTarget[], targetFavor: number): AugmentTarget[] {
  const favorTargets = targets.filter((t) => t.predictedFavor < targetFavor)
  if (favorTargets.length > 0) {
    return [...favorTargets].sort(
      (a, b) => targetFavor - a.predictedFavor - (targetFavor - b.predictedFavor)
    )
  }
  return [...targets].sort((a, b) => a.repGap - b.repGap)
}

export function findAugmentTargets(ns: NS, playerFactions: readonly FactionName[]): AugmentTarget[] {
  return prioritizeTargets(gatherAugmentTargets(ns, playerFactions), getTargetFavor(ns))
}

function idleReason(ns: NS, faction: FactionName): string {
  const owned = new Set(ns.singularity.getOwnedAugmentations(true))
  const augments = ns.singularity.getAugmentationsFromFaction(faction)
  const pending = augments.filter((a) => !a.startsWith("NeuroFlux Governor") && !owned.has(a))

  if (pending.length === 0) return "All augmentations owned"

  const currentRep = ns.singularity.getFactionRep(faction)
  if (pending.every((a) => currentRep >= ns.singularity.getAugmentationRepReq(a))) {
    return "Reputation met for remaining augments"
  }

  return "No pending work"
}

function primaryTargetInFaction(
  factionTargets: AugmentTarget[],
  favorMode: boolean,
  targetFavor: number
): AugmentTarget | undefined {
  if (factionTargets.length === 0) return undefined
  const favorNeed = factionTargets.filter((t) => t.predictedFavor < targetFavor)
  if (favorMode && favorNeed.length > 0) {
    return [...favorNeed].sort(
      (a, b) => targetFavor - a.predictedFavor - (targetFavor - b.predictedFavor)
    )[0]
  }
  return [...factionTargets].sort((a, b) => a.repGap - b.repGap)[0]
}

function buildReason(
  ns: NS,
  row: FactionWorkRow,
  best: AugmentTarget,
  favorMode: boolean,
  targetFavor: number
): string {
  if (row.mode === "idle") {
    if (favorMode && row.predictedFavor >= targetFavor) {
      return `Favor ≥ ${targetFavor} after reset; rep deferred`
    }
    return row.reason
  }

  if (row.isSelected) {
    return favorMode
      ? `Lowest favor gap to ${targetFavor} (hacking contracts)`
      : "Lowest rep gap — working toward augment"
  }

  if (favorMode && row.mode === "favor") {
    const bestGap = targetFavor - best.predictedFavor
    const rowGap = row.favorGap
    return `Favor gap ${rowGap.toFixed(1)} > ${bestGap.toFixed(1)}`
  }

  if (row.repGap > best.repGap) {
    return `Rep gap ${ns.format.number(row.repGap)} > ${ns.format.number(best.repGap)}`
  }
  if (row.faction === best.faction && row.augmentName !== best.augmentName) {
    return `Same faction; ${best.augmentName} first`
  }

  return "Lower priority"
}

export function buildFactionWorkRows(
  ns: NS,
  playerFactions: readonly FactionName[],
  allTargets: AugmentTarget[],
  prioritized: AugmentTarget[],
  best: AugmentTarget | null
): FactionWorkRow[] {
  const targetFavor = getTargetFavor(ns)
  const favorMode = best != null && best.predictedFavor < targetFavor
  const rows: FactionWorkRow[] = []

  for (const faction of playerFactions) {
    const factionTargets = allTargets.filter((t) => t.faction === faction)
    const favor = ns.singularity.getFactionFavor(faction)
    const predictedFavor = favor + ns.singularity.getFactionFavorGain(faction)

    if (factionTargets.length === 0) {
      rows.push({
        faction,
        mode: "idle",
        augmentName: "—",
        currentRep: ns.singularity.getFactionRep(faction),
        requiredRep: 0,
        repGap: 0,
        favor,
        predictedFavor,
        favorGap: Math.max(0, targetFavor - predictedFavor),
        reason: idleReason(ns, faction),
        isSelected: false,
      })
      continue
    }

    const primary = primaryTargetInFaction(factionTargets, favorMode, targetFavor)!
    const favorGap = Math.max(0, targetFavor - primary.predictedFavor)
    const isSelected =
      best != null && primary.faction === best.faction && primary.augmentName === best.augmentName

    const mode: FactionWorkMode =
      favorMode && primary.predictedFavor < targetFavor ? "favor" : favorMode ? "idle" : "rep"

    const row: FactionWorkRow = {
      faction,
      mode,
      augmentName: primary.augmentName,
      currentRep: primary.currentRep,
      requiredRep: primary.requiredRep,
      repGap: primary.repGap,
      favor: primary.favor,
      predictedFavor: primary.predictedFavor,
      favorGap,
      reason: "",
      isSelected,
    }
    row.reason = best ? buildReason(ns, row, best, favorMode, targetFavor) : idleReason(ns, faction)
    rows.push(row)
  }

  const priorityOrder = new Map<FactionName, number>()
  prioritized.forEach((t, idx) => {
    if (!priorityOrder.has(t.faction)) priorityOrder.set(t.faction, idx)
  })

  rows.sort((a, b) => {
    if (a.isSelected) return -1
    if (b.isSelected) return 1
    const ai = priorityOrder.get(a.faction) ?? 9999
    const bi = priorityOrder.get(b.faction) ?? 9999
    if (ai !== bi) return ai - bi
    return a.faction.localeCompare(b.faction)
  })

  return rows
}

export function buildFactionWorkTableConfig(
  ns: NS,
  rows: FactionWorkRow[],
  best: AugmentTarget | null
): ReactTableConfig {
  const targetFavor = getTargetFavor(ns)
  const selectedRowIndex = rows.findIndex((r) => r.isSelected)
  const highlightCells =
    selectedRowIndex >= 0 ? new Set([`${selectedRowIndex},0`, `${selectedRowIndex},1`]) : undefined
  const favorMode = best != null && best.predictedFavor < targetFavor
  const title = best
    ? favorMode
      ? `Faction work (favor ${targetFavor}) → ${best.faction}`
      : `Faction work — ${best.augmentName} @ ${best.faction}`
    : `Faction work — nothing pending (favor target ${targetFavor})`

  return {
    title,
    columns: [
      { header: "Faction", align: "left", minWidth: 12 },
      { header: "Work", align: "center", minWidth: 4 },
      { header: "Mode", align: "left", minWidth: 6 },
      { header: "Augment", align: "left", minWidth: 16 },
      { header: "Rep", align: "right" },
      { header: "Required", align: "right" },
      { header: "Rep gap", align: "right" },
      { header: "Favor", align: "right" },
      { header: "After reset", align: "right" },
      { header: `Gap→${targetFavor}`, align: "right" },
      { header: "Why", align: "left", minWidth: 24 },
    ],
    rows: rows.map((row) => {
      const hasAugment = row.augmentName !== "—"
      return [
        row.faction,
        row.isSelected ? "→" : "",
        row.mode === "favor" ? "Favor" : row.mode === "rep" ? "Rep" : "—",
        row.augmentName,
        hasAugment ? ns.format.number(row.currentRep) : "—",
        hasAugment ? ns.format.number(row.requiredRep) : "—",
        hasAugment ? ns.format.number(row.repGap) : "—",
        row.favor.toFixed(1),
        row.predictedFavor.toFixed(1),
        row.favorGap > 0 ? row.favorGap.toFixed(1) : "—",
        row.reason,
      ]
    }),
    selectedRowIndex: selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    highlightCells,
  }
}
