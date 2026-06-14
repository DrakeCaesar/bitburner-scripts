import { FactionName, FactionWorkType, NS } from "@ns"
import {
  AUGMENT_QUEUE_PRICE_MULT,
  filterAugmentPurchaseFactions,
  getAugmentCatalog,
  getAugmentData,
  getAugmentNamesFromFaction,
  getNextNeuroFluxLevel,
  getOwnedAugmentationNames,
  isAugmentPurchaseExcludedFaction,
  isNeuroFluxAugment,
  sortAugmentsForPurchase,
  type AugmentInfo,
} from "./augmentations.js"
import { col, W, type ReactTableConfig } from "./scriptLogUiLayout.js"

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

/** Factions whose augments count toward the normal buy / infiltration plan (excludes SoA). */
export function getInfiltrationPurchaseFactions(ns: NS): FactionName[] {
  return filterAugmentPurchaseFactions(ns.getPlayer().factions)
}

function augmentExcludedFromInfiltrationPlan(ns: NS, augName: string): boolean {
  const entry = getAugmentCatalog(ns).get(augName)
  if (!entry) return true
  return entry.factions.every((faction) => isAugmentPurchaseExcludedFaction(faction))
}

function isPurchasePlannedAugment(aug: AugmentInfo): boolean {
  return aug.factions.some((faction) => !isAugmentPurchaseExcludedFaction(faction))
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
  const ownedAugments = getOwnedAugmentationNames(ns)
  const catalog = getAugmentCatalog(ns)
  const targets: AugmentTarget[] = []
  const augmentsWithEnoughRep = new Set<string>()

  for (const faction of playerFactions) {
    if (!factionOffersWork(ns, faction)) continue
    if (isAugmentPurchaseExcludedFaction(faction)) continue

    const currentRep = ns.singularity.getFactionRep(faction)

    for (const augName of getAugmentNamesFromFaction(ns, faction)) {
      if (ownedAugments.has(augName)) continue
      if (isNeuroFluxAugment(augName)) continue
      if (augmentExcludedFromInfiltrationPlan(ns, augName)) continue

      const requiredRep = catalog.get(augName)?.repReq
      if (requiredRep == null) continue
      if (currentRep >= requiredRep) augmentsWithEnoughRep.add(augName)
    }
  }

  for (const faction of playerFactions) {
    if (!factionOffersWork(ns, faction)) continue
    if (isAugmentPurchaseExcludedFaction(faction)) continue

    const currentRep = ns.singularity.getFactionRep(faction)

    for (const augName of getAugmentNamesFromFaction(ns, faction)) {
      if (ownedAugments.has(augName)) continue
      if (isNeuroFluxAugment(augName)) continue
      if (augmentExcludedFromInfiltrationPlan(ns, augName)) continue
      if (augmentsWithEnoughRep.has(augName)) continue

      const requiredRep = catalog.get(augName)?.repReq
      if (requiredRep == null) continue

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

/** Total rep from zero that equals donation favor (e.g. 150). */
export function repForTargetFavor(ns: NS, targetFavor?: number): number {
  try {
    return ns.formulas.reputation.calculateFavorToRep(targetFavor ?? getTargetFavor(ns))
  } catch {
    return 0
  }
}

export type InfiltrationRepTier = "pre-favor-aug" | "favor" | "post-favor-aug" | "neuroflux"

export type InfiltrationMoneyTier = "pre-favor-aug" | "post-favor-aug" | "neuroflux"

export interface InfiltrationGrindTarget extends AugmentTarget {
  tier: InfiltrationRepTier
}

type InfiltrationAugmentBucket = "pre-favor" | "post-favor"

function augmentInBucket(aug: AugmentInfo, repForDonation: number, bucket: InfiltrationAugmentBucket): boolean {
  return bucket === "pre-favor" ? aug.repReq < repForDonation : aug.repReq >= repForDonation
}

function augmentMeetsRep(aug: AugmentInfo, factionReps: Map<string, number>): boolean {
  return aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)
}

function getPendingAugmentsInBucket(
  ns: NS,
  purchaseFactions: readonly FactionName[],
  bucket: InfiltrationAugmentBucket
): AugmentInfo[] {
  const repForDonation = repForTargetFavor(ns)
  const { allAugs } = getAugmentData(ns, [...purchaseFactions])
  return allAugs.filter(
    (aug) => augmentInBucket(aug, repForDonation, bucket) && isPurchasePlannedAugment(aug)
  )
}

type BucketGrindNeed = "rep" | "money"

/** Next unowned augment in purchase order that still needs infiltration rep or money. */
function getBucketGrindHead(
  ns: NS,
  purchaseFactions: readonly FactionName[],
  bucket: InfiltrationAugmentBucket
): { aug: AugmentInfo; need: BucketGrindNeed } | null {
  const pending = getPendingAugmentsInBucket(ns, purchaseFactions, bucket)
  if (pending.length === 0) return null

  const { factionReps, playerMoney } = getAugmentData(ns, [...purchaseFactions])
  for (const aug of sortAugmentsForPurchase(pending)) {
    if (!augmentMeetsRep(aug, factionReps)) return { aug, need: "rep" }
    const adjustedPrice = aug.price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, 0)
    if (playerMoney < adjustedPrice) return { aug, need: "money" }
  }

  return null
}

function buildInfiltrationTargetForAugment(
  ns: NS,
  aug: AugmentInfo,
  workableFactions: readonly FactionName[],
  tier: InfiltrationRepTier
): InfiltrationGrindTarget | null {
  let best: InfiltrationGrindTarget | null = null

  for (const faction of aug.factions) {
    if (!workableFactions.includes(faction)) continue
    if (!factionOffersWork(ns, faction)) continue

    const currentRep = ns.singularity.getFactionRep(faction)
    if (currentRep >= aug.repReq) continue

    const favor = ns.singularity.getFactionFavor(faction)
    const favorGain = ns.singularity.getFactionFavorGain(faction)
    const target: InfiltrationGrindTarget = {
      augmentName: aug.name,
      faction,
      currentRep,
      requiredRep: aug.repReq,
      repGap: aug.repReq - currentRep,
      favor,
      favorGain,
      predictedFavor: favor + favorGain,
      tier,
    }

    if (!best || target.repGap < best.repGap) best = target
  }

  return best
}

/** Unowned augments from this faction that need rep at or above the donation-favor threshold. */
function factionHasPendingPostFavorAugments(
  ns: NS,
  faction: FactionName,
  repForDonation: number
): boolean {
  const owned = getOwnedAugmentationNames(ns)
  const catalog = getAugmentCatalog(ns)

  if (isAugmentPurchaseExcludedFaction(faction)) return false

  for (const augName of getAugmentNamesFromFaction(ns, faction)) {
    if (owned.has(augName)) continue
    if (isNeuroFluxAugment(augName)) continue
    if (augmentExcludedFromInfiltrationPlan(ns, augName)) continue
    const repReq = catalog.get(augName)?.repReq
    if (repReq == null) continue
    if (repReq >= repForDonation) return true
  }

  return false
}

function hasPendingFavorGrind(
  ns: NS,
  playerFactions: readonly FactionName[],
  targetFavor: number,
  repForDonation: number
): boolean {
  for (const faction of playerFactions) {
    if (!factionOffersWork(ns, faction)) continue
    if (!factionHasPendingPostFavorAugments(ns, faction, repForDonation)) continue
    const predictedFavor =
      ns.singularity.getFactionFavor(faction) + ns.singularity.getFactionFavorGain(faction)
    if (predictedFavor < targetFavor) return true
  }
  return false
}

function isRegularAugmentPipelineComplete(
  ns: NS,
  workableFactions: readonly FactionName[],
  purchaseFactions: readonly FactionName[],
  targetFavor: number,
  repForDonation: number
): boolean {
  if (getPendingAugmentsInBucket(ns, purchaseFactions, "pre-favor").length > 0) return false
  if (hasPendingFavorGrind(ns, workableFactions, targetFavor, repForDonation)) return false
  if (getPendingAugmentsInBucket(ns, purchaseFactions, "post-favor").length > 0) return false
  return true
}

function buildNeuroFluxGrindTarget(
  ns: NS,
  levelIndex: number,
  faction: FactionName,
  currentRep: number,
  repReq: number,
  repGap: number
): InfiltrationGrindTarget {
  const favor = ns.singularity.getFactionFavor(faction)
  const favorGain = ns.singularity.getFactionFavorGain(faction)

  return {
    augmentName: levelIndex > 0 ? `NeuroFlux Governor +${levelIndex}` : "NeuroFlux Governor",
    faction,
    currentRep,
    requiredRep: repReq,
    repGap,
    favor,
    favorGain,
    predictedFavor: favor + favorGain,
    tier: "neuroflux",
  }
}

function buildFavorGrindTarget(ns: NS, faction: FactionName, targetFavor: number): AugmentTarget {
  const favor = ns.singularity.getFactionFavor(faction)
  const favorGain = ns.singularity.getFactionFavorGain(faction)
  const currentRep = ns.singularity.getFactionRep(faction)
  const predictedFavor = favor + favorGain
  const repNeeded = repNeededForTargetFavor(ns, faction, favor, currentRep, targetFavor) ?? 0

  return {
    augmentName: `donation favor ${targetFavor}`,
    faction,
    currentRep,
    requiredRep: currentRep + repNeeded,
    repGap: repNeeded,
    favor,
    favorGain,
    predictedFavor,
  }
}

/** Active money-save phase, or null when grinding reputation or nothing pending. */
export function getInfiltrationMoneyTier(
  ns: NS,
  workableFactions: readonly FactionName[]
): InfiltrationMoneyTier | null {
  const purchaseFactions = getInfiltrationPurchaseFactions(ns)
  const targetFavor = getTargetFavor(ns)
  const repForDonation = repForTargetFavor(ns, targetFavor)
  const neuroFluxGrindFactions = infiltrationNeuroFluxGrindFactions(workableFactions, purchaseFactions)

  const preFavorHead = getBucketGrindHead(ns, purchaseFactions, "pre-favor")
  if (preFavorHead?.need === "rep") return null
  if (preFavorHead?.need === "money") return "pre-favor-aug"
  if (getPendingAugmentsInBucket(ns, purchaseFactions, "pre-favor").length > 0) return null

  if (hasPendingFavorGrind(ns, workableFactions, targetFavor, repForDonation)) return null

  const postFavorHead = getBucketGrindHead(ns, purchaseFactions, "post-favor")
  if (postFavorHead?.need === "rep") return null
  if (postFavorHead?.need === "money") return "post-favor-aug"
  if (getPendingAugmentsInBucket(ns, purchaseFactions, "post-favor").length > 0) return null

  if (
    isRegularAugmentPipelineComplete(
      ns,
      workableFactions,
      purchaseFactions,
      targetFavor,
      repForDonation
    ) &&
    getNextNeuroFluxLevel(ns, purchaseFactions, neuroFluxGrindFactions)?.need === "money"
  ) {
    return "neuroflux"
  }

  return null
}

function infiltrationNeuroFluxGrindFactions(
  workableFactions: readonly FactionName[],
  purchaseFactions: readonly FactionName[]
): Set<FactionName> {
  const grind = new Set<FactionName>(workableFactions)
  for (const faction of purchaseFactions) {
    grind.add(faction)
  }
  return grind
}

export function needsInfiltrationMoneyForAugments(
  ns: NS,
  playerFactions: readonly FactionName[]
): boolean {
  return getInfiltrationMoneyTier(ns, playerFactions) != null
}

/**
 * Infiltration grind order:
 * 1. Pre-favor augments - rep then money for each augment in purchase order
 * 2. Donation favor (factions with unowned post-favor augments only) - reputation
 * 3. Post-favor augments - rep then money for each augment in purchase order
 * 4. NeuroFlux Governor - reputation, then money
 */
export function prioritizeInfiltrationRepTargets(
  ns: NS,
  workableFactions: readonly FactionName[]
): InfiltrationGrindTarget[] {
  const purchaseFactions = getInfiltrationPurchaseFactions(ns)
  const neuroFluxGrindFactions = infiltrationNeuroFluxGrindFactions(workableFactions, purchaseFactions)
  const targetFavor = getTargetFavor(ns)
  const repForDonation = repForTargetFavor(ns, targetFavor)

  const preFavorHead = getBucketGrindHead(ns, purchaseFactions, "pre-favor")
  if (preFavorHead?.need === "rep") {
    const target = buildInfiltrationTargetForAugment(
      ns,
      preFavorHead.aug,
      workableFactions,
      "pre-favor-aug"
    )
    if (target) return [target]
  }
  if (
    preFavorHead?.need === "money" ||
    getPendingAugmentsInBucket(ns, purchaseFactions, "pre-favor").length > 0
  ) {
    return []
  }

  const favorTargets: InfiltrationGrindTarget[] = []
  for (const faction of workableFactions) {
    if (!factionOffersWork(ns, faction)) continue
    if (!factionHasPendingPostFavorAugments(ns, faction, repForDonation)) continue
    const predictedFavor =
      ns.singularity.getFactionFavor(faction) + ns.singularity.getFactionFavorGain(faction)
    if (predictedFavor >= targetFavor) continue
    favorTargets.push({ ...buildFavorGrindTarget(ns, faction, targetFavor), tier: "favor" })
  }
  favorTargets.sort((a, b) => targetFavor - a.predictedFavor - (targetFavor - b.predictedFavor))
  if (favorTargets.length > 0) return favorTargets

  const postFavorHead = getBucketGrindHead(ns, purchaseFactions, "post-favor")
  if (postFavorHead?.need === "rep") {
    const target = buildInfiltrationTargetForAugment(
      ns,
      postFavorHead.aug,
      workableFactions,
      "post-favor-aug"
    )
    if (target) return [target]
  }
  if (
    postFavorHead?.need === "money" ||
    getPendingAugmentsInBucket(ns, purchaseFactions, "post-favor").length > 0
  ) {
    return []
  }

  if (
    !isRegularAugmentPipelineComplete(
      ns,
      workableFactions,
      purchaseFactions,
      targetFavor,
      repForDonation
    )
  ) {
    return []
  }

  const nextNeuroFlux = getNextNeuroFluxLevel(ns, purchaseFactions, neuroFluxGrindFactions)
  if (nextNeuroFlux?.need === "rep") {
    return [
      buildNeuroFluxGrindTarget(
        ns,
        nextNeuroFlux.levelIndex,
        nextNeuroFlux.faction,
        nextNeuroFlux.currentRep,
        nextNeuroFlux.repReq,
        nextNeuroFlux.repGap
      ),
    ]
  }

  return []
}

export function getInfiltrationGrindTarget(ns: NS): InfiltrationGrindTarget | null {
  const purchaseFactions = getInfiltrationPurchaseFactions(ns)
  const workableFactions = filterWorkableFactions(ns, purchaseFactions)
  return prioritizeInfiltrationRepTargets(ns, workableFactions)[0] ?? null
}

/** Faction that needs reputation next for infiltration victory trades. */
export function getPreferredFactionForInfiltrationRep(ns: NS): FactionName | null {
  return getInfiltrationGrindTarget(ns)?.faction ?? null
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
  const owned = getOwnedAugmentationNames(ns)
  const catalog = getAugmentCatalog(ns)
  const pending = getAugmentNamesFromFaction(ns, faction).filter(
    (augName) => !isNeuroFluxAugment(augName) && !owned.has(augName)
  )

  if (pending.length === 0) return "All augmentations owned"

  const currentRep = ns.singularity.getFactionRep(faction)
  if (pending.every((augName) => currentRep >= (catalog.get(augName)?.repReq ?? Infinity))) {
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
        col("Faction", "left", W.faction),
        col("Work", "center", W.work),
        col("Job", "left", W.job),
        col("Augment", "left", W.augment),
        col("Rep", "right"),
        col("Required", "right"),
        col("Rep gap", "right"),
        col("Rep ETA", "right", W.rate),
        col("At", "left", W.timeAt),
        col("Favor", "right"),
        col("After reset", "right"),
        col(`Fav→${targetFavor}`, "right"),
        col("Why", "left", W.why),
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
      col("Faction", "left", W.faction),
      col("Work", "center", W.work),
      col("Job", "left", W.job),
      col("Mode", "left", W.mode),
      col("Augment", "left", W.augment),
      col("Rep", "right"),
      col("Required", "right"),
      col("Rep gap", "right"),
      col("Favor", "right"),
      col("After reset", "right"),
      col(`Gap→${targetFavor}`, "right"),
      col("Favor ETA", "right", W.rate),
      col("At", "left", W.timeAt),
      col("Why", "left", W.why),
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
