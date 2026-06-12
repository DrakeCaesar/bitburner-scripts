import { FactionName, NS } from "@ns"
import {
  AUGMENT_QUEUE_PRICE_MULT,
  AugmentInfo,
  filterAugmentPurchaseFactions,
  getAugmentCatalog,
  getAugmentData,
  getOwnedAugmentationNames,
  isNeuroFluxAugment,
  neuroFluxPurchaseCost,
  type AugmentCatalogEntry,
} from "./augmentations.js"
import { col, W, type ReactTableConfig } from "./scriptLogUiLayout.js"

/** Augment stat multipliers returned by ns.singularity.getAugmentationStats */
export interface AugmentMultipliers {
  hacking: number
  hacking_exp: number
  hacking_money: number
  hacking_grow: number
  hacking_speed: number
  hacking_chance: number
  faction_rep: number
  company_rep: number
  work_money: number
  crime_money: number
  crime_success: number
  strength: number
  strength_exp: number
  defense: number
  defense_exp: number
  dexterity: number
  dexterity_exp: number
  agility: number
  agility_exp: number
  charisma: number
  charisma_exp: number
  hacknet_node_money: number
  hacknet_node_purchase_cost: number
  hacknet_node_level_cost: number
  hacknet_node_ram_cost: number
  hacknet_node_core_cost: number
  bladeburner_analysis: number
  bladeburner_max_stamina: number
  bladeburner_stamina_gain: number
  bladeburner_success_chance: number
  dnet_money: number
}

export const AUGMENT_STAT_COLUMNS: ReadonlyArray<{ key: keyof AugmentMultipliers; header: string }> = [
  { key: "hacking", header: "Hck" },
  { key: "hacking_exp", header: "HckXp" },
  { key: "hacking_money", header: "H$" },
  { key: "hacking_grow", header: "Grow" },
  { key: "hacking_speed", header: "Spd" },
  { key: "hacking_chance", header: "Chnc" },
  { key: "faction_rep", header: "FacRep" },
  { key: "company_rep", header: "CoRep" },
  { key: "work_money", header: "Work$" },
  { key: "crime_money", header: "Crime$" },
  { key: "crime_success", header: "Crime%" },
  { key: "strength", header: "Str" },
  { key: "strength_exp", header: "StrXp" },
  { key: "defense", header: "Def" },
  { key: "defense_exp", header: "DefXp" },
  { key: "dexterity", header: "Dex" },
  { key: "dexterity_exp", header: "DexXp" },
  { key: "agility", header: "Agi" },
  { key: "agility_exp", header: "AgiXp" },
  { key: "charisma", header: "Cha" },
  { key: "charisma_exp", header: "ChaXp" },
  { key: "hacknet_node_money", header: "Hnet$" },
  { key: "hacknet_node_purchase_cost", header: "HnetBuy" },
  { key: "hacknet_node_level_cost", header: "HnetLvl" },
  { key: "hacknet_node_ram_cost", header: "HnetRam" },
  { key: "hacknet_node_core_cost", header: "HnetCore" },
  { key: "bladeburner_analysis", header: "BBAna" },
  { key: "bladeburner_max_stamina", header: "BBStam" },
  { key: "bladeburner_stamina_gain", header: "BBStGn" },
  { key: "bladeburner_success_chance", header: "BBSucc" },
  { key: "dnet_money", header: "Dnet$" },
]

type AugmentRowKind = "buy" | "goal" | "noRep" | "neuroFluxBuy" | "neuroFluxNext"

export interface AugmentStatsDisplayRow {
  kind: AugmentRowKind
  order: string
  name: string
  faction: string
  rep: string
  repRed: boolean
  price: string
  adjusted: string
  cumulative: string
  owned: string
  status: string
  statsAugmentName: string
}

const CITY_FACTIONS = ["Aevum", "Sector12", "Volhaven", "Chongqing", "Ishima", "NewTokyo"] as const

function formatFactionText(factions: string[], maxWidth = 28): string {
  const joined = factions.join(", ")
  if (joined.length <= maxWidth) return joined
  return `${joined.substring(0, maxWidth - 3)}...`
}

function formatPrereqText(prereqs: string[], maxWidth = 28): string {
  if (prereqs.length === 0) return ""
  const joined = prereqs.join(", ")
  if (joined.length <= maxWidth) return joined
  return `${joined.substring(0, maxWidth - 3)}...`
}

function factionsMeetingRepReq(
  factions: FactionName[],
  factionReps: Map<string, number>,
  repReq: number
): FactionName[] {
  return factions.filter((f) => (factionReps.get(f) ?? 0) >= repReq)
}

/** Same faction set as the floating augment dashboard (includes city factions for planning). */
export function resolveAugmentDashboardFactions(ns: NS): FactionName[] {
  const factions = filterAugmentPurchaseFactions(ns.getPlayer().factions)
  const inCityFaction = factions.some((f) => CITY_FACTIONS.includes(f as (typeof CITY_FACTIONS)[number]))
  if (!inCityFaction) {
    factions.push(
      ns.enums.FactionName.Aevum,
      ns.enums.FactionName.Sector12,
      ns.enums.FactionName.Volhaven,
      ns.enums.FactionName.Chongqing,
      ns.enums.FactionName.Ishima,
      ns.enums.FactionName.NewTokyo
    )
  }
  return factions
}

export function formatAugmentStatValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value === 1) return ""
  const pct = (value - 1) * 100
  if (Math.abs(pct) < 0.05) return ""
  const rounded = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1)
  return pct > 0 ? `+${rounded}%` : `${rounded}%`
}

function getAugmentStatsCached(ns: NS, name: string, cache: Map<string, AugmentMultipliers>): AugmentMultipliers {
  const cached = cache.get(name)
  if (cached) return cached
  const stats = (getAugmentCatalog(ns).get(name)?.stats ?? {}) as unknown as AugmentMultipliers
  cache.set(name, stats)
  return stats
}

function buildAdjustedCosts(affordableSorted: AugmentInfo[]): { adjustedPrices: number[]; cumulativeCosts: number[] } {
  let cumulativeCost = 0
  const adjustedPrices: number[] = []
  const cumulativeCosts: number[] = []

  for (let i = 0; i < affordableSorted.length; i++) {
    const adjustedPrice = affordableSorted[i].price * Math.pow(AUGMENT_QUEUE_PRICE_MULT, i)
    adjustedPrices.push(adjustedPrice)
    cumulativeCost += adjustedPrice
    cumulativeCosts.push(cumulativeCost)
  }

  return { adjustedPrices, cumulativeCosts }
}

export function gatherAugmentStatsDisplayRows(ns: NS): {
  rows: AugmentStatsDisplayRow[]
  neuroFluxSeparatorIndex: number | null
  summary: string
} {
  const factions = resolveAugmentDashboardFactions(ns)
  const { affordableSorted, tooExpensiveCumulative, unaffordable, neuroFluxInfo, playerMoney, factionReps } =
    getAugmentData(ns, factions)
  const { adjustedPrices, cumulativeCosts } = buildAdjustedCosts(affordableSorted)

  type DisplayRow = {
    aug: AugmentInfo
    kind: "buy" | "goal" | "noRep"
    buyIndex?: number
  }

  const displayByPrice: DisplayRow[] = [
    ...tooExpensiveCumulative
      .filter((aug) => !isNeuroFluxAugment(aug.name))
      .map((aug) => ({ aug, kind: "goal" as const })),
    ...affordableSorted
      .map((aug, buyIndex) => ({ aug, kind: "buy" as const, buyIndex }))
      .filter((row) => !isNeuroFluxAugment(row.aug.name)),
    ...unaffordable
      .filter((aug) => !isNeuroFluxAugment(aug.name))
      .map((aug) => ({ aug, kind: "noRep" as const })),
  ].sort((a, b) => b.aug.price - a.aug.price)

  const rows: AugmentStatsDisplayRow[] = []

  for (const { aug, kind, buyIndex } of displayByPrice) {
    const hasEnoughMoney = playerMoney >= aug.price
    const hasEnoughRep = aug.factions.some((faction) => (factionReps.get(faction) ?? 0) >= aug.repReq)
    const validFactions = aug.factions.filter((f) => (factionReps.get(f) ?? 0) >= aug.repReq)
    const factionList = validFactions.length > 0 ? validFactions : aug.factions

    if (kind === "buy" && buyIndex !== undefined) {
      rows.push({
        kind: "buy",
        order: String(buyIndex + 1),
        name: aug.name,
        faction: formatFactionText(validFactions),
        rep: ns.format.number(aug.repReq),
        repRed: false,
        price: ns.format.number(aug.price),
        adjusted: ns.format.number(adjustedPrices[buyIndex]),
        cumulative: ns.format.number(cumulativeCosts[buyIndex]),
        owned: aug.owned ? "Y" : "",
        status: "Y",
        statsAugmentName: aug.name,
      })
      continue
    }

    let statusSymbol = ">$"
    if (kind === "noRep") {
      statusSymbol = "X"
      if (!hasEnoughMoney && !hasEnoughRep) statusSymbol = "XX"
      else if (!hasEnoughMoney) statusSymbol = "X$"
      else if (!hasEnoughRep) statusSymbol = "XR"
    }

    rows.push({
      kind,
      order: "",
      name: aug.name,
      faction: formatFactionText(factionList),
      rep: ns.format.number(aug.repReq),
      repRed: kind === "noRep" && !hasEnoughRep,
      price: ns.format.number(aug.price),
      adjusted: "",
      cumulative: "",
      owned: aug.owned ? "Y" : "",
      status: statusSymbol,
      statsAugmentName: aug.name,
    })
  }

  let neuroFluxSeparatorIndex: number | null = null
  let orderNum = affordableSorted.length + 1

  if (neuroFluxInfo) {
    neuroFluxSeparatorIndex = rows.length > 0 ? rows.length - 1 : null

    const lastAffordableCost = affordableSorted.length > 0 ? cumulativeCosts[affordableSorted.length - 1] : 0
    let remainingMoney = playerMoney - lastAffordableCost
    const positionOffset = affordableSorted.length
    let neuroFluxCumulative = lastAffordableCost
    let neuroFluxIndex = 0
    const maxFactionRep = Math.max(...neuroFluxInfo.factions.map((f) => factionReps.get(f) ?? 0))

    while (true) {
      const { price: currentPrice, repReq: currentRepReq } = neuroFluxPurchaseCost(
        neuroFluxInfo,
        positionOffset,
        neuroFluxIndex
      )
      if (remainingMoney < currentPrice || maxFactionRep < currentRepReq) break

      neuroFluxCumulative += currentPrice
      const levelBasePrice = currentPrice / Math.pow(AUGMENT_QUEUE_PRICE_MULT, positionOffset + neuroFluxIndex)
      const nfFactionsAtLevel = factionsMeetingRepReq(neuroFluxInfo.factions, factionReps, currentRepReq)

      rows.push({
        kind: "neuroFluxBuy",
        order: String(orderNum),
        name: neuroFluxInfo.name,
        faction: formatFactionText(nfFactionsAtLevel),
        rep: ns.format.number(currentRepReq),
        repRed: false,
        price: ns.format.number(levelBasePrice),
        adjusted: ns.format.number(currentPrice),
        cumulative: ns.format.number(neuroFluxCumulative),
        owned: neuroFluxInfo.owned ? "Y" : "",
        status: "~",
        statsAugmentName: neuroFluxInfo.name,
      })

      remainingMoney -= currentPrice
      neuroFluxIndex++
      orderNum++
    }

    const { price: nextPrice, repReq: nextRepReq } = neuroFluxPurchaseCost(
      neuroFluxInfo,
      positionOffset,
      neuroFluxIndex
    )
    const nextCumulative = neuroFluxCumulative + nextPrice
    const levelBasePrice = nextPrice / Math.pow(AUGMENT_QUEUE_PRICE_MULT, positionOffset + neuroFluxIndex)
    const canAffordMoney = remainingMoney >= nextPrice
    const hasEnoughRep = maxFactionRep >= nextRepReq

    let statusSymbol = "X"
    if (!canAffordMoney && !hasEnoughRep) statusSymbol = "XX"
    else if (!canAffordMoney) statusSymbol = "X$"
    else if (!hasEnoughRep) statusSymbol = "XR"

    const nfFactionsAtLevel = factionsMeetingRepReq(neuroFluxInfo.factions, factionReps, nextRepReq)

    rows.push({
      kind: "neuroFluxNext",
      order: "",
      name: neuroFluxInfo.name,
      faction: formatFactionText(nfFactionsAtLevel.length > 0 ? nfFactionsAtLevel : neuroFluxInfo.factions),
      rep: ns.format.number(nextRepReq),
      repRed: !hasEnoughRep,
      price: ns.format.number(levelBasePrice),
      adjusted: ns.format.number(nextPrice),
      cumulative: ns.format.number(nextCumulative),
      owned: neuroFluxInfo.owned ? "Y" : "",
      status: statusSymbol,
      statsAugmentName: neuroFluxInfo.name,
    })
  }

  const summary =
    `Regular augments by base price | NeuroFlux at bottom | Buying: ${affordableSorted.length}` +
    ` | Goals: ${tooExpensiveCumulative.length} | No rep: ${unaffordable.length}` +
    ` | Money: ${ns.format.number(playerMoney)}`

  return { rows, neuroFluxSeparatorIndex, summary }
}

export function buildAugmentStatsTableConfig(ns: NS): ReactTableConfig & { summary: string } {
  const { rows, neuroFluxSeparatorIndex, summary } = gatherAugmentStatsDisplayRows(ns)
  const statsCache = new Map<string, AugmentMultipliers>()

  const baseColumns = [
    col("#", "right", W.order),
    col("Augmentation", "left", W.augmentName),
    col("Faction", "left", W.faction),
    col("Rep Req", "right", W.rep),
    col("Price", "right", W.num),
    col("Adj Price", "right", W.num),
    col("Total Cost", "right", W.price),
    col("Own", "center", W.own),
    col("Stat", "center", W.flag),
  ]

  const statColumns = AUGMENT_STAT_COLUMNS.map(({ header }) => col(header, "right", W.stat))

  const highlightCells = new Set<string>()
  const separatorAfter: number[] = []
  if (neuroFluxSeparatorIndex !== null) {
    separatorAfter.push(neuroFluxSeparatorIndex)
  }

  const tableRows = rows.map((row, rowIdx) => {
    if (row.kind === "buy" || row.kind === "neuroFluxBuy") {
      highlightCells.add(`${rowIdx},0`)
      highlightCells.add(`${rowIdx},8`)
    }

    const stats = getAugmentStatsCached(ns, row.statsAugmentName, statsCache)
    const statCells = AUGMENT_STAT_COLUMNS.map(({ key }, colIdx) => {
      const value = formatAugmentStatValue(stats[key])
      const statColIdx = baseColumns.length + colIdx
      if (value) highlightCells.add(`${rowIdx},${statColIdx}`)
      return value
    })

    return [
      row.order,
      row.name,
      row.faction,
      row.rep,
      row.price,
      row.adjusted,
      row.cumulative,
      row.owned,
      row.status,
      ...statCells,
    ]
  })

  return {
    title: "Augmentations",
    summary,
    columns: [...baseColumns, ...statColumns],
    rows: tableRows,
    separatorAfter,
    highlightCells,
  }
}

export function buildAugmentCatalogTableConfig(ns: NS): ReactTableConfig & { summary: string } {
  const catalog = getAugmentCatalog(ns)
  const owned = getOwnedAugmentationNames(ns)
  const entries = [...catalog.values()].sort((a, b) => b.basePrice - a.basePrice || a.name.localeCompare(b.name))
  const statsCache = new Map<string, AugmentMultipliers>()

  const baseColumns = [
    col("Augmentation", "left", W.augmentName),
    col("Faction", "left", W.faction),
    col("Base Price", "right", W.price),
    col("Rep Req", "right", W.rep),
    col("Prereq", "left", W.faction),
    col("Own", "center", W.own),
  ]

  const statColumns = AUGMENT_STAT_COLUMNS.map(({ header }) => col(header, "right", W.stat))
  const highlightCells = new Set<string>()
  const ownColIdx = baseColumns.length - 1

  const tableRows = entries.map((entry: AugmentCatalogEntry, rowIdx) => {
    const isOwned = owned.has(entry.name)
    if (isOwned) {
      highlightCells.add(`${rowIdx},${ownColIdx}`)
    }

    const stats = getAugmentStatsCached(ns, entry.name, statsCache)
    const statCells = AUGMENT_STAT_COLUMNS.map(({ key }, colIdx) => {
      const value = formatAugmentStatValue(stats[key])
      const statColIdx = baseColumns.length + colIdx
      if (value) highlightCells.add(`${rowIdx},${statColIdx}`)
      return value
    })

    return [
      entry.name,
      formatFactionText(entry.factions),
      ns.format.number(entry.basePrice),
      ns.format.number(entry.repReq),
      formatPrereqText(entry.prereqs),
      isOwned ? "Y" : "",
      ...statCells,
    ]
  })

  const ownedCount = entries.filter((entry) => owned.has(entry.name)).length
  const summary = `All game augments: ${entries.length} | Owned: ${ownedCount} | Sorted by base price`

  return {
    title: "Augment Catalog",
    summary,
    columns: [...baseColumns, ...statColumns],
    rows: tableRows,
    highlightCells,
  }
}
