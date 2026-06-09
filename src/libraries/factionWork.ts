import { FactionName, FactionWorkType, NS } from "@ns"
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

/** favor: grind donation favor on all factions first; augments: smallest rep gap to next unlock. */
export type FactionWorkPriority = "favor" | "augments"

export function parseFactionWorkPriority(ns: NS): FactionWorkPriority {
  const arg = String(ns.args[0] ?? "").toLowerCase()
  if (arg === "augments" || arg === "aug" || arg === "a" || arg === "rep" || arg === "unlock") {
    return "augments"
  }
  return "favor"
}

export interface FactionWorkRow {
  faction: FactionName
  mode: FactionWorkMode
  /** Best rep/s job this faction offers (for display and ETAs). */
  job: string
  augmentName: string
  currentRep: number
  requiredRep: number
  repGap: number
  favor: number
  predictedFavor: number
  favorGap: number
  /** ETA for active target (favor or augment rep, depending on priority). */
  targetEtaDuration: string
  targetEtaAt: string
  reason: string
  isSelected: boolean
}

const CYCLES_PER_SECOND = 1000 / 200
const UNFOCUSED_FOCUS_MULT = 0.8

/** Factions like Shadows of Anarchy have no hacking/field/security jobs. */
export function factionOffersWork(ns: NS, faction: FactionName): boolean {
  return ns.singularity.getFactionWorkTypes(faction).length > 0
}

export function filterWorkableFactions(ns: NS, factions: readonly FactionName[]): FactionName[] {
  return factions.filter((faction) => factionOffersWork(ns, faction))
}

export interface WorkTargetEta {
  durationMs: number | null
  durationLabel: string
  atLabel: string
}

/** Rep still needed (while working) before install would reach target favor. */
export function repNeededForTargetFavor(
  ns: NS,
  faction: FactionName,
  favor: number,
  currentRep: number,
  targetFavor: number
): number | null {
  try {
    const repAtTarget = ns.formulas.reputation.calculateFavorToRep(targetFavor)
    const repBanked = ns.formulas.reputation.calculateFavorToRep(favor) + currentRep
    return Math.max(0, repAtTarget - repBanked)
  } catch {
    return null
  }
}

export function formatFactionWorkType(workType: FactionWorkType): string {
  if (workType === "hacking") return "Hack"
  if (workType === "field") return "Field"
  return "Sec"
}

function focusMultiplier(ns: NS): number {
  return ns.singularity.isFocused() ? 1 : UNFOCUSED_FOCUS_MULT
}

export function factionRepPerSecond(
  ns: NS,
  workType: FactionWorkType,
  favor: number
): number | null {
  try {
    const gains = ns.formulas.work.factionGains(ns.getPlayer(), workType, favor)
    return gains.reputation * CYCLES_PER_SECOND * focusMultiplier(ns)
  } catch {
    return null
  }
}

/** Highest rep/s work type this faction offers. */
export function getBestFactionWorkType(ns: NS, faction: FactionName): FactionWorkType | null {
  const types = ns.singularity.getFactionWorkTypes(faction)
  if (types.length === 0) return null

  const favor = ns.singularity.getFactionFavor(faction)
  let bestType: FactionWorkType | null = null
  let bestRep = -1

  for (const workType of types) {
    const rep = factionRepPerSecond(ns, workType, favor)
    if (rep != null && rep > bestRep) {
      bestRep = rep
      bestType = workType
    }
  }

  return bestType
}

export function startFactionWork(
  ns: NS,
  faction: FactionName,
  focus?: boolean
): { ok: boolean; workType: FactionWorkType | null } {
  const workType = getBestFactionWorkType(ns, faction)
  if (workType == null) return { ok: false, workType: null }

  const ok = ns.singularity.workForFaction(faction, workType, focus ?? ns.singularity.isFocused())
  return { ok, workType }
}

/** Stop player faction work only; leaves gym, crime, company work, etc. untouched. */
export function stopFactionWorkIfActive(ns: NS): boolean {
  const work = ns.singularity.getCurrentWork()
  if (work?.type !== "FACTION") {
    return false
  }
  return ns.singularity.stopAction()
}

/** ETA to reach augment rep target via hacking contracts (assumes continuous work). */
export function estimateAugmentRepEta(
  ns: NS,
  faction: FactionName,
  repGap: number,
  favor: number
): WorkTargetEta {
  if (repGap <= 0) {
    return { durationMs: 0, durationLabel: "done", atLabel: "—" }
  }

  const workType = getBestFactionWorkType(ns, faction)
  const repPerSecond = workType != null ? factionRepPerSecond(ns, workType, favor) : null
  if (repPerSecond == null || repPerSecond <= 0) {
    return { durationMs: null, durationLabel: "—", atLabel: "—" }
  }

  const durationMs = (repGap / repPerSecond) * 1000
  return {
    durationMs,
    durationLabel: ns.format.time(durationMs),
    atLabel: new Date(Date.now() + durationMs).toLocaleString(),
  }
}

/** ETA to reach donation favor target (assumes continuous work on best job). */
export function estimateFavorTargetEta(
  ns: NS,
  faction: FactionName,
  targetFavor: number
): WorkTargetEta {
  const favor = ns.singularity.getFactionFavor(faction)
  const currentRep = ns.singularity.getFactionRep(faction)
  const predictedFavor = favor + ns.singularity.getFactionFavorGain(faction)

  if (predictedFavor >= targetFavor) {
    return { durationMs: 0, durationLabel: "done", atLabel: "—" }
  }

  const repNeeded = repNeededForTargetFavor(ns, faction, favor, currentRep, targetFavor)
  if (repNeeded == null) {
    return { durationMs: null, durationLabel: "—", atLabel: "—" }
  }
  if (repNeeded <= 0) {
    return { durationMs: 0, durationLabel: "now", atLabel: "—" }
  }

  const workType = getBestFactionWorkType(ns, faction)
  const repPerSecond = workType != null ? factionRepPerSecond(ns, workType, favor) : null
  if (repPerSecond == null || repPerSecond <= 0) {
    return { durationMs: null, durationLabel: "—", atLabel: "—" }
  }

  const durationMs = (repNeeded / repPerSecond) * 1000
  return {
    durationMs,
    durationLabel: ns.format.time(durationMs),
    atLabel: new Date(Date.now() + durationMs).toLocaleString(),
  }
}

function jobLabelForFaction(ns: NS, faction: FactionName): string {
  const workType = getBestFactionWorkType(ns, faction)
  return workType != null ? formatFactionWorkType(workType) : "—"
}

export function gatherAugmentTargets(ns: NS, playerFactions: readonly FactionName[]): AugmentTarget[] {
  const ownedAugments = new Set(ns.singularity.getOwnedAugmentations(true))
  const targets: AugmentTarget[] = []
  const augmentsWithEnoughRep = new Set<string>()

  for (const faction of playerFactions) {
    if (!factionOffersWork(ns, faction)) continue

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
    if (!factionOffersWork(ns, faction)) continue

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

export function prioritizeTargets(
  targets: AugmentTarget[],
  targetFavor: number,
  priority: FactionWorkPriority = "favor"
): AugmentTarget[] {
  if (priority === "augments") {
    return [...targets].sort((a, b) => a.repGap - b.repGap)
  }

  const favorTargets = targets.filter((t) => t.predictedFavor < targetFavor)
  if (favorTargets.length > 0) {
    return [...favorTargets].sort(
      (a, b) => targetFavor - a.predictedFavor - (targetFavor - b.predictedFavor)
    )
  }
  return [...targets].sort((a, b) => a.repGap - b.repGap)
}

export function findAugmentTargets(
  ns: NS,
  playerFactions: readonly FactionName[],
  priority: FactionWorkPriority = "favor"
): AugmentTarget[] {
  return prioritizeTargets(gatherAugmentTargets(ns, playerFactions), getTargetFavor(ns), priority)
}

/** Faction that needs reputation next, using the same rules as autoWorkFactions. */
export function getPreferredFactionForRep(
  ns: NS,
  priority: FactionWorkPriority = "favor"
): FactionName | null {
  const workableFactions = filterWorkableFactions(ns, ns.getPlayer().factions)
  const bestTarget = findAugmentTargets(ns, workableFactions, priority)[0]
  return bestTarget?.faction ?? null
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
  globalFavorGrind: boolean,
  targetFavor: number,
  priority: FactionWorkPriority
): AugmentTarget | undefined {
  if (factionTargets.length === 0) return undefined
  if (priority === "augments") {
    return [...factionTargets].sort((a, b) => a.repGap - b.repGap)[0]
  }
  const favorNeed = factionTargets.filter((t) => t.predictedFavor < targetFavor)
  if (globalFavorGrind && favorNeed.length > 0) {
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
  globalFavorGrind: boolean,
  targetFavor: number,
  priority: FactionWorkPriority,
  bestJob: string
): string {
  if (row.mode === "idle") {
    if (globalFavorGrind && row.predictedFavor >= targetFavor) {
      return `Favor ≥ ${targetFavor} after reset; rep deferred`
    }
    return row.reason
  }

  if (row.isSelected) {
    if (priority === "augments") {
      return `Smallest rep gap — ${bestJob} work`
    }
    return globalFavorGrind
      ? `Lowest favor gap to ${targetFavor} (${bestJob})`
      : `Lowest rep gap — ${bestJob} work`
  }

  if (priority === "augments" && row.predictedFavor < targetFavor) {
    return `Augments priority (favor ${row.predictedFavor.toFixed(1)} < ${targetFavor})`
  }

  if (globalFavorGrind && row.mode === "favor") {
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
  best: AugmentTarget | null,
  priority: FactionWorkPriority = "favor"
): FactionWorkRow[] {
  const targetFavor = getTargetFavor(ns)
  const globalFavorGrind =
    priority === "favor" && best != null && best.predictedFavor < targetFavor
  const rows: FactionWorkRow[] = []

  for (const faction of playerFactions) {
    const favor = ns.singularity.getFactionFavor(faction)
    const predictedFavor = favor + ns.singularity.getFactionFavorGain(faction)

    if (!factionOffersWork(ns, faction)) {
      rows.push({
        faction,
        mode: "idle",
        job: "—",
        augmentName: "—",
        currentRep: ns.singularity.getFactionRep(faction),
        requiredRep: 0,
        repGap: 0,
        favor,
        predictedFavor,
        favorGap: Math.max(0, targetFavor - predictedFavor),
        targetEtaDuration: "—",
        targetEtaAt: "—",
        reason: "No faction work",
        isSelected: false,
      })
      continue
    }

    const factionTargets = allTargets.filter((t) => t.faction === faction)

    if (factionTargets.length === 0) {
      const favorGap = Math.max(0, targetFavor - predictedFavor)
      rows.push({
        faction,
        mode: "idle",
        job: jobLabelForFaction(ns, faction),
        augmentName: "—",
        currentRep: ns.singularity.getFactionRep(faction),
        requiredRep: 0,
        repGap: 0,
        favor,
        predictedFavor,
        favorGap,
        targetEtaDuration: "—",
        targetEtaAt: "—",
        reason: idleReason(ns, faction),
        isSelected: false,
      })
      continue
    }

    const primary = primaryTargetInFaction(factionTargets, globalFavorGrind, targetFavor, priority)!
    const favorGap = Math.max(0, targetFavor - primary.predictedFavor)
    const isSelected =
      best != null && primary.faction === best.faction && primary.augmentName === best.augmentName

    const mode: FactionWorkMode =
      priority === "augments"
        ? "rep"
        : globalFavorGrind && primary.predictedFavor < targetFavor
          ? "favor"
          : globalFavorGrind
            ? "idle"
            : "rep"

    const eta = targetEtaForRow(
      ns,
      faction,
      priority,
      targetFavor,
      primary.favor,
      primary.repGap,
      true
    )
    const job = jobLabelForFaction(ns, faction)
    const row: FactionWorkRow = {
      faction,
      mode,
      job,
      augmentName: primary.augmentName,
      currentRep: primary.currentRep,
      requiredRep: primary.requiredRep,
      repGap: primary.repGap,
      favor: primary.favor,
      predictedFavor: primary.predictedFavor,
      favorGap,
      targetEtaDuration: eta?.durationLabel ?? "—",
      targetEtaAt: eta?.atLabel ?? "—",
      reason: "",
      isSelected,
    }
    row.reason = best
      ? buildReason(ns, row, best, globalFavorGrind, targetFavor, priority, job)
      : idleReason(ns, faction)
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

function targetEtaForRow(
  ns: NS,
  faction: FactionName,
  priority: FactionWorkPriority,
  targetFavor: number,
  favor: number,
  repGap: number,
  hasAugment: boolean
): WorkTargetEta | null {
  if (!hasAugment) return null
  if (priority === "augments") {
    return repGap > 0 ? estimateAugmentRepEta(ns, faction, repGap, favor) : null
  }
  const favorGap = Math.max(0, targetFavor - (favor + ns.singularity.getFactionFavorGain(faction)))
  return favorGap > 0 ? estimateFavorTargetEta(ns, faction, targetFavor) : null
}

export function buildFactionWorkTableConfig(
  ns: NS,
  rows: FactionWorkRow[],
  best: AugmentTarget | null,
  priority: FactionWorkPriority = "favor"
): ReactTableConfig {
  const targetFavor = getTargetFavor(ns)
  const selectedRowIndex = rows.findIndex((r) => r.isSelected)
  const highlightCells =
    selectedRowIndex >= 0 ? new Set([`${selectedRowIndex},0`, `${selectedRowIndex},1`]) : undefined
  const globalFavorGrind =
    priority === "favor" && best != null && best.predictedFavor < targetFavor
  const title = best
    ? priority === "augments"
      ? `Faction work (augments) — ${best.augmentName} @ ${best.faction}`
      : globalFavorGrind
        ? `Faction work (favor ${targetFavor}) → ${best.faction}`
        : `Faction work — ${best.augmentName} @ ${best.faction}`
    : priority === "augments"
      ? "Faction work (augments) — nothing pending"
      : `Faction work — nothing pending (favor target ${targetFavor})`

  if (priority === "augments") {
    return {
      title,
      columns: [
        { header: "Faction", align: "left", minWidth: 12 },
        { header: "Work", align: "center", minWidth: 4 },
        { header: "Job", align: "left", minWidth: 5 },
        { header: "Augment", align: "left", minWidth: 16 },
        { header: "Rep", align: "right" },
        { header: "Required", align: "right" },
        { header: "Rep gap", align: "right" },
        { header: "Rep ETA", align: "right", minWidth: 10 },
        { header: "At", align: "left", minWidth: 18 },
        { header: "Favor", align: "right" },
        { header: "After reset", align: "right" },
        { header: `Fav→${targetFavor}`, align: "right" },
        { header: "Why", align: "left", minWidth: 24 },
      ],
      rows: rows.map((row) => {
        const hasAugment = row.augmentName !== "—"
        return [
          row.faction,
          row.isSelected ? "→" : "",
          row.job,
          row.augmentName,
          hasAugment ? ns.format.number(row.currentRep) : "—",
          hasAugment ? ns.format.number(row.requiredRep) : "—",
          hasAugment ? ns.format.number(row.repGap) : "—",
          hasAugment && row.repGap > 0 ? row.targetEtaDuration : "—",
          hasAugment && row.repGap > 0 ? row.targetEtaAt : "—",
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

  return {
    title,
    columns: [
      { header: "Faction", align: "left", minWidth: 12 },
      { header: "Work", align: "center", minWidth: 4 },
      { header: "Job", align: "left", minWidth: 5 },
      { header: "Mode", align: "left", minWidth: 6 },
      { header: "Augment", align: "left", minWidth: 16 },
      { header: "Rep", align: "right" },
      { header: "Required", align: "right" },
      { header: "Rep gap", align: "right" },
      { header: "Favor", align: "right" },
      { header: "After reset", align: "right" },
      { header: `Gap→${targetFavor}`, align: "right" },
      { header: "Favor ETA", align: "right", minWidth: 10 },
      { header: "At", align: "left", minWidth: 18 },
      { header: "Why", align: "left", minWidth: 24 },
    ],
    rows: rows.map((row) => {
      const hasAugment = row.augmentName !== "—"
      return [
        row.faction,
        row.isSelected ? "→" : "",
        row.job,
        row.mode === "favor" ? "Favor" : row.mode === "rep" ? "Rep" : "—",
        row.augmentName,
        hasAugment ? ns.format.number(row.currentRep) : "—",
        hasAugment ? ns.format.number(row.requiredRep) : "—",
        hasAugment ? ns.format.number(row.repGap) : "—",
        row.favor.toFixed(1),
        row.predictedFavor.toFixed(1),
        row.favorGap > 0 ? row.favorGap.toFixed(1) : "—",
        row.favorGap > 0 ? row.targetEtaDuration : "—",
        row.favorGap > 0 ? row.targetEtaAt : "—",
        row.reason,
      ]
    }),
    selectedRowIndex: selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    highlightCells,
  }
}
