import type { FactionName, NS } from "@ns"
import { getPreferredFactionForRep, parseFactionWorkPriority } from "../factionWork.js"
import { getInfiltrationRewardGoal, isInfiltrationMoneyMode } from "./infiltrationTargets.js"
import { findButtonByTextPrefix, invokeTrustedClick } from "./infiltrationGameBridge.js"
import { waitForCityNavigationReady } from "./infiltrationNavigation.js"

const VICTORY_TITLE = "Infiltration successful!"
const VICTORY_REWARD_SELECT_DELAY_MS = 5000
const VICTORY_REWARD_CONFIRM_DELAY_MS = 5000

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

type ReactFiberLike = {
  memoizedProps?: Record<string, unknown>
  pendingProps?: Record<string, unknown>
  child?: ReactFiberLike | null
  sibling?: ReactFiberLike | null
  return?: ReactFiberLike | null
}

interface VictoryScreenRewards {
  sellCash: number | null
  tradeRep: number | null
}

interface VictoryRewardSnapshot {
  money: number
  factionRep: number | null
}

type VictorySubmitAction = "sell" | "trade"

function getReactFiber(node: Element): ReactFiberLike | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (node as unknown as Record<string, ReactFiberLike>)[key]
    }
  }
  return null
}

export function isInfiltrationVictoryScreen(): boolean {
  for (const heading of Array.from(document.querySelectorAll("h4"))) {
    if (normalizeText(heading.textContent ?? "") === VICTORY_TITLE) {
      return true
    }
  }
  return false
}

function findVictoryRoot(): Element | null {
  for (const heading of Array.from(document.querySelectorAll("h4"))) {
    if (normalizeText(heading.textContent ?? "") !== VICTORY_TITLE) continue
    return heading.closest(".MuiPaper-root")
  }
  return null
}

function getVictoryFactionSelect(): HTMLElement | null {
  const root = findVictoryRoot()
  if (!root) return null

  const combobox = root.querySelector('[role="combobox"]')
  return combobox instanceof HTMLElement ? combobox : null
}

/** Outermost MUI Select fiber (Victory.tsx factionName state), not the inner combobox. */
function getVictorySelectFiber(): ReactFiberLike | null {
  const combobox = getVictoryFactionSelect()
  if (!combobox) return null

  let fiber: ReactFiberLike | null = getReactFiber(combobox)
  const seen = new Set<ReactFiberLike>()
  let selectFiber: ReactFiberLike | null = null

  while (fiber) {
    if (seen.has(fiber)) break
    seen.add(fiber)

    for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
      if (
        props &&
        typeof props.onChange === "function" &&
        typeof props.value === "string"
      ) {
        selectFiber = fiber
      }
    }

    fiber = fiber.return ?? null
  }

  return selectFiber
}

function readVictorySelectFiberValue(fiber: ReactFiberLike): string {
  for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
    if (props && typeof props.value === "string") {
      return normalizeText(props.value)
    }
  }
  return ""
}

function getVictorySelectValue(): string {
  const selectFiber = getVictorySelectFiber()
  if (!selectFiber) return ""
  return readVictorySelectFiberValue(selectFiber)
}

function invokeVictorySelectFiberChange(fiber: ReactFiberLike, factionName: string): void {
  for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
    if (props && typeof props.onChange === "function") {
      ;(props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: factionName },
      })
      return
    }
  }
}

function getVictoryMenuItemValue(option: Element): string {
  const dataValue = option.getAttribute("data-value")
  if (dataValue != null && dataValue !== "") {
    return normalizeText(dataValue)
  }
  return normalizeText(option.textContent ?? "")
}

/** Always apply selection; visible label can disagree with React factionName state. */
function invokeVictorySelectChange(factionName: string): boolean {
  const selectFiber = getVictorySelectFiber()
  if (selectFiber) {
    invokeVictorySelectFiberChange(selectFiber, factionName)
  }

  const combobox = getVictoryFactionSelect()
  if (combobox) {
    invokeTrustedClick(combobox)
    for (const option of Array.from(document.querySelectorAll('[role="option"], .MuiMenuItem-root'))) {
      if (getVictoryMenuItemValue(option) !== factionName) continue
      invokeTrustedClick(option as HTMLElement)
      break
    }
  }

  return getVictorySelectValue() === factionName
}

function clickVictoryButton(prefix: string): { ok: boolean; detail: string } {
  const button = findButtonByTextPrefix(prefix)
  if (!button) {
    return { ok: false, detail: `${prefix} button not found` }
  }
  if (button.disabled) {
    return { ok: false, detail: `${prefix} button disabled` }
  }

  invokeTrustedClick(button)
  return { ok: true, detail: prefix }
}

function walkFiberTreeForNumberProp(
  fiber: ReactFiberLike | null,
  propName: string,
  seen = new Set<ReactFiberLike>(),
  depth = 0
): number | null {
  if (!fiber || depth > 80 || seen.has(fiber)) return null
  seen.add(fiber)

  for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
    const value = props?.[propName]
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }

  return (
    walkFiberTreeForNumberProp(fiber.child ?? null, propName, seen, depth + 1) ??
    walkFiberTreeForNumberProp(fiber.sibling ?? null, propName, seen, depth + 1)
  )
}

function readRewardFromButton(prefix: string, propName: string): number | null {
  const button = findButtonByTextPrefix(prefix)
  if (!button) return null
  return walkFiberTreeForNumberProp(getReactFiber(button), propName)
}

function readVictoryScreenRewards(): VictoryScreenRewards {
  return {
    sellCash: readRewardFromButton("Sell for", "money"),
    tradeRep: readRewardFromButton("Trade for", "reputation"),
  }
}

function snapshotPlayerRewards(ns: NS, faction: FactionName | null): VictoryRewardSnapshot {
  return {
    money: ns.getPlayer().money,
    factionRep: faction != null ? ns.singularity.getFactionRep(faction) : null,
  }
}

function logVictoryRewardAudit(context: {
  intendedFaction: string | null
  intendedAction: VictorySubmitAction
  actualAction: VictorySubmitAction
  actualFaction: string | null
  dropdownAtSubmit: string
  expected: VictoryScreenRewards
  before: VictoryRewardSnapshot
  after: VictoryRewardSnapshot
}): void {
  const moneyDelta = context.after.money - context.before.money
  const factionDelta =
    context.before.factionRep != null && context.after.factionRep != null
      ? context.after.factionRep - context.before.factionRep
      : null

  if (context.actualAction === "sell") {
    if (context.expected.sellCash != null && moneyDelta + 1 < context.expected.sellCash) {
      console.log(
        "[infiltration victory] money shortfall:" +
          ` expected >= ${context.expected.sellCash},` +
          ` before ${context.before.money}, after ${context.after.money}, delta ${moneyDelta}`
      )
    }
    if (context.intendedAction === "trade") {
      console.log(
        "[infiltration victory] intended trade but sold:" +
          ` wanted ${context.intendedFaction ?? "?"},` +
          ` dropdown at submit "${context.dropdownAtSubmit}"`
      )
    }
    return
  }

  if (context.expected.tradeRep != null && factionDelta != null && factionDelta + 1 < context.expected.tradeRep) {
    console.log(
      "[infiltration victory] faction rep shortfall:" +
        ` faction ${context.actualFaction ?? "?"},` +
        ` expected >= ${context.expected.tradeRep},` +
        ` before ${context.before.factionRep}, after ${context.after.factionRep}, delta ${factionDelta},` +
        ` dropdown at submit "${context.dropdownAtSubmit}"` +
        (context.intendedFaction !== context.actualFaction
          ? `, intended ${context.intendedFaction ?? "?"}`
          : "")
    )
  }
}

async function confirmVictoryReward(
  ns: NS,
  detail: string,
  audit?: {
    intendedFaction: string | null
    intendedAction: VictorySubmitAction
    actualAction: VictorySubmitAction
    actualFaction: string | null
    dropdownAtSubmit: string
    expected: VictoryScreenRewards
    before: VictoryRewardSnapshot
  }
): Promise<{ ok: boolean; detail: string }> {
  if (!(await waitForCityNavigationReady(ns))) {
    return { ok: false, detail: `${detail} (UI did not close)` }
  }

  if (audit) {
    const after = snapshotPlayerRewards(
      ns,
      audit.actualAction === "trade" ? (audit.actualFaction as FactionName | null) : null
    )
    logVictoryRewardAudit({ ...audit, after })
  }

  return { ok: true, detail }
}

export async function collectInfiltrationVictoryReward(
  ns: NS
): Promise<{ ok: boolean; detail: string }> {
  if (!isInfiltrationVictoryScreen()) {
    return { ok: false, detail: "not on victory screen" }
  }

  const rewardGoal = getInfiltrationRewardGoal(ns)
  const faction =
    rewardGoal === "reputation"
      ? getPreferredFactionForRep(ns, parseFactionWorkPriority(ns))
      : null
  const expected = readVictoryScreenRewards()
  const before = snapshotPlayerRewards(ns, faction)
  const intendedAction: VictorySubmitAction = faction != null ? "trade" : "sell"
  const auditBase = {
    intendedFaction: faction,
    intendedAction,
    expected,
    before,
  }

  ns.print(`Victory reward: selecting in ${VICTORY_REWARD_SELECT_DELAY_MS / 1000}s`)
  await ns.sleep(VICTORY_REWARD_SELECT_DELAY_MS)

  let rewardAction = "sell for money"
  if (faction) {
    invokeVictorySelectChange(faction)
    const selected = getVictorySelectValue()
    if (selected === faction) {
      rewardAction = `trade for ${faction} reputation`
    } else {
      ns.print(
        `Victory reward: preferred faction is ${faction}, dropdown shows "${selected || "none"}"; will sell for money`
      )
    }
  } else if (isInfiltrationMoneyMode(ns)) {
    ns.print("Victory reward: money mode; will sell for money")
  } else {
    ns.print("Victory reward: no faction needs reputation; will sell for money")
  }

  ns.print(`Victory reward: confirming in ${VICTORY_REWARD_CONFIRM_DELAY_MS / 1000}s (${rewardAction})`)
  await ns.sleep(VICTORY_REWARD_CONFIRM_DELAY_MS)

  if (faction) {
    invokeVictorySelectChange(faction)
    const selected = getVictorySelectValue()
    if (selected === faction) {
      const dropdownAtSubmit = getVictorySelectValue()
      const traded = clickVictoryButton("Trade for")
      if (traded.ok) {
        return confirmVictoryReward(ns, `traded for ${faction} reputation`, {
          ...auditBase,
          actualAction: "trade",
          actualFaction: faction,
          dropdownAtSubmit,
        })
      }
    }
  }

  const dropdownAtSubmit = getVictorySelectValue()
  const sold = clickVictoryButton("Sell for")
  if (sold.ok) {
    return confirmVictoryReward(ns, "sold for money", {
      ...auditBase,
      actualAction: "sell",
      actualFaction: null,
      dropdownAtSubmit,
    })
  }
  return sold
}
