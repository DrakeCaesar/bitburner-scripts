import type { FactionName, NS } from "@ns"
import { getPreferredFactionForRep, parseFactionWorkPriority } from "../factionWork.js"
import { getInfiltrationRewardGoal, isInfiltrationMoneyMode } from "./infiltrationTargets.js"
import { waitForCityNavigationReady } from "./infiltrationNavigation.js"

const VICTORY_TITLE = "Infiltration successful!"
const SHADOWS_OF_ANARCHY = "Shadows of Anarchy"
const VICTORY_REWARD_SELECT_DELAY_MS = 500
const VICTORY_REWARD_CONFIRM_DELAY_MS = 500
const VICTORY_MENU_OPEN_WAIT_MS = 1500
const VICTORY_STATE_SETTLE_MS = 200
const VICTORY_TRADE_RENDER_DELAY_MS = 300

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

type ReactFiberLike = {
  type?: { name?: string } | string
  memoizedProps?: Record<string, unknown>
  pendingProps?: Record<string, unknown>
  memoizedState?: unknown
  child?: ReactFiberLike | null
  sibling?: ReactFiberLike | null
  return?: ReactFiberLike | null
}

type ReactHookSlot = {
  memoizedState?: unknown
  next?: ReactHookSlot | null
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

function findVictoryButtonByTextPrefix(prefix: string): HTMLButtonElement | null {
  const root = findVictoryRoot()
  const buttons = root
    ? Array.from(root.querySelectorAll("button"))
    : Array.from(document.querySelectorAll("button"))

  for (const button of buttons) {
    if (normalizeText(button.textContent ?? "").startsWith(prefix)) {
      return button
    }
  }
  return null
}

function getFiberTypeName(fiber: ReactFiberLike): string | null {
  const type = fiber.type
  if (typeof type === "string") return type
  if (typeof type === "function") return type.name || null
  return null
}

function walkFiberTree(
  fiber: ReactFiberLike | null,
  visit: (fiber: ReactFiberLike) => void,
  seen = new Set<ReactFiberLike>()
): void {
  if (!fiber || seen.has(fiber)) return
  seen.add(fiber)
  visit(fiber)
  walkFiberTree(fiber.child ?? null, visit, seen)
  walkFiberTree(fiber.sibling ?? null, visit, seen)
}

/**
 * Victory.tsx: const [factionName, setFactionName] = useState(defaultFactionChoice)
 * trade() closes over this hook -- not the uncontrolled MUI Select display state.
 */
function readVictoryUseStateFaction(fiber: ReactFiberLike): string | null {
  const firstHook = fiber.memoizedState as ReactHookSlot | null
  if (firstHook && typeof firstHook.memoizedState === "string") {
    return normalizeText(firstHook.memoizedState)
  }
  return null
}

function fiberDepthUnderAncestor(fiber: ReactFiberLike, ancestor: ReactFiberLike): number {
  let depth = 0
  let current: ReactFiberLike | null = fiber
  while (current && current !== ancestor) {
    depth++
    current = current.return ?? null
  }
  return current === ancestor ? depth : Number.POSITIVE_INFINITY
}

function hasVictorySelectOnChange(fiber: ReactFiberLike): boolean {
  for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
    if (props && typeof props.onChange === "function") {
      return true
    }
  }
  return false
}

function getVictoryFactionSelect(): HTMLElement | null {
  const root = findVictoryRoot()
  if (!root) return null

  const combobox = root.querySelector('[role="combobox"]')
  return combobox instanceof HTMLElement ? combobox : null
}

/** Victory.tsx function component (owns factionName useState). */
function findVictoryComponentFiber(): ReactFiberLike | null {
  const root = findVictoryRoot()
  if (!root) return null

  let found: ReactFiberLike | null = null
  walkFiberTree(getReactFiber(root), (fiber) => {
    if (getFiberTypeName(fiber) === "Victory") {
      found = fiber
    }
  })
  if (found) return found

  const tradeButton = findVictoryButtonByTextPrefix("Trade for")
  if (!tradeButton) return null

  let fiber: ReactFiberLike | null = getReactFiber(tradeButton)
  const seen = new Set<ReactFiberLike>()
  while (fiber) {
    if (seen.has(fiber)) break
    seen.add(fiber)

    if (readVictoryUseStateFaction(fiber) != null) {
      return fiber
    }

    fiber = fiber.return ?? null
  }

  return null
}

/** factionName useState on Victory.tsx -- trade() reads this closure value. */
function readVictoryFactionState(): string | null {
  const victory = findVictoryComponentFiber()
  if (!victory) return null
  return readVictoryUseStateFaction(victory)
}

/**
 * Victory.tsx wires <Select onChange={changeDropdown}> where changeDropdown calls
 * setFactionName. Pick the shallowest onChange under Victory, not MUI internals
 * found by walking up from the combobox (those update display only).
 */
function getVictorySelectFiber(): ReactFiberLike | null {
  const victory = findVictoryComponentFiber()
  if (!victory) return null

  const candidates: ReactFiberLike[] = []
  walkFiberTree(victory, (fiber) => {
    if (hasVictorySelectOnChange(fiber)) {
      candidates.push(fiber)
    }
  })

  if (candidates.length === 0) return null

  let best = candidates[0]
  let bestDepth = fiberDepthUnderAncestor(best, victory)
  for (let i = 1; i < candidates.length; i++) {
    const depth = fiberDepthUnderAncestor(candidates[i], victory)
    if (depth < bestDepth) {
      best = candidates[i]
      bestDepth = depth
    }
  }

  return best
}

function getVictoryComboboxDisplayValue(): string {
  const combobox = getVictoryFactionSelect()
  if (!combobox) return ""

  const display =
    combobox.closest(".MuiSelect-root")?.querySelector(".MuiSelect-select") ?? combobox
  const text = normalizeText(display.textContent ?? "")
  if (text) return text

  return normalizeText(combobox.textContent ?? "")
}

function invokeVictorySelectFiberChange(fiber: ReactFiberLike, factionName: string): void {
  for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
    if (props && typeof props.onChange === "function") {
      ;(props.onChange as (event: { target: { value: string; name?: string } }) => void)({
        target: { value: factionName, name: "" },
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

function getNudgeFactionForTarget(factions: string[], targetFaction: string): string | null {
  const targetIndex = factions.indexOf(targetFaction)
  if (targetIndex < 0 || factions.length < 2) return null

  if (targetIndex === 0) return factions[1]
  if (targetIndex === factions.length - 1) return factions[factions.length - 2]
  return factions[targetIndex - 1]
}

function getWorkableFactionChoices(ns: NS): string[] {
  return [...ns.getPlayer().factions]
}

async function waitForVictoryFactionState(
  ns: NS,
  factionName: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (readVictoryFactionState() === factionName) {
      return true
    }
    await ns.sleep(50)
  }
  return readVictoryFactionState() === factionName
}

async function setVictoryFactionState(ns: NS, factionName: string): Promise<boolean> {
  const selectFiber = getVictorySelectFiber()
  if (!selectFiber) return false

  invokeVictorySelectFiberChange(selectFiber, factionName)
  return waitForVictoryFactionState(ns, factionName, 500)
}

async function waitForVictoryMenuOptions(ns: NS): Promise<Element[]> {
  const deadline = Date.now() + VICTORY_MENU_OPEN_WAIT_MS
  while (Date.now() < deadline) {
    const options = Array.from(
      document.querySelectorAll('[role="option"], .MuiMenuItem-root')
    ).filter((option) => {
      const value = getVictoryMenuItemValue(option)
      return value !== "" && value !== "none"
    })
    if (options.length > 0) return options
    await ns.sleep(50)
  }
  return []
}

function openVictoryFactionMenuUi(): void {
  const root = findVictoryRoot()
  const targets: HTMLElement[] = []
  const combobox = getVictoryFactionSelect()
  if (combobox) targets.push(combobox)

  if (root) {
    for (const selector of [".MuiSelect-select", ".MuiSelect-icon", ".MuiInputBase-root"]) {
      const element = root.querySelector(selector)
      if (element instanceof HTMLElement) targets.push(element)
    }
  }

  for (const target of targets) {
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    )
    target.click()
  }
}

async function clickVictoryFactionMenuOption(ns: NS, factionName: string): Promise<boolean> {
  openVictoryFactionMenuUi()
  const options = await waitForVictoryMenuOptions(ns)
  if (options.length === 0) return false

  for (const option of options) {
    if (getVictoryMenuItemValue(option) !== factionName) continue
    if (!(option instanceof HTMLElement)) return false

    option.click()
    await ns.sleep(VICTORY_STATE_SETTLE_MS)
    return true
  }

  return false
}

/**
 * Set Victory factionName via Select onChange (what trade() uses). UI clicks are fallback only.
 */
async function invokeVictorySelectChange(ns: NS, factionName: string): Promise<boolean> {
  const current = readVictoryFactionState()
  const choices = getWorkableFactionChoices(ns)

  if (current === factionName) {
    const nudgeFaction = getNudgeFactionForTarget(choices, factionName)
    if (nudgeFaction != null) {
      await setVictoryFactionState(ns, nudgeFaction)
      await ns.sleep(VICTORY_STATE_SETTLE_MS)
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await setVictoryFactionState(ns, factionName)) {
      return true
    }
    await ns.sleep(VICTORY_STATE_SETTLE_MS)
  }

  if (await clickVictoryFactionMenuOption(ns, factionName)) {
    return setVictoryFactionState(ns, factionName)
  }

  return readVictoryFactionState() === factionName
}

function isVictoryFactionReadyForTrade(factionName: string): boolean {
  return readVictoryFactionState() === factionName && factionName !== "none"
}

/**
 * Victory.tsx trade() closes over factionName from the render that created the handler.
 * invokeTrustedClick calls stale memoizedProps.onClick from before setFactionName re-render,
 * so rep can go to defaultFactionChoice (current-work faction) while useState already updated.
 * Native click goes through React's current listener after commit.
 */
async function waitForVictoryTradeButtonCommit(ns: NS, factionName: string): Promise<boolean> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (!isVictoryFactionReadyForTrade(factionName)) {
      await ns.sleep(50)
      continue
    }

    const button = findVictoryButtonByTextPrefix("Trade for")
    const fiber = button ? getReactFiber(button) : null
    if (!fiber || fiber.pendingProps == null) {
      await ns.sleep(VICTORY_TRADE_RENDER_DELAY_MS)
      return true
    }

    await ns.sleep(50)
  }

  return isVictoryFactionReadyForTrade(factionName)
}

function clickVictoryButton(prefix: string): { ok: boolean; detail: string } {
  const button = findVictoryButtonByTextPrefix(prefix)
  if (!button) {
    return { ok: false, detail: `${prefix} button not found` }
  }
  if (button.disabled) {
    return { ok: false, detail: `${prefix} button disabled` }
  }

  button.click()
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
  const button = findVictoryButtonByTextPrefix(prefix)
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

function snapshotAllFactionReps(ns: NS): Map<string, number> {
  const reps = new Map<string, number>()
  for (const faction of ns.getPlayer().factions) {
    reps.set(faction, ns.singularity.getFactionRep(faction))
  }
  return reps
}

function findTradeRepRecipient(
  before: Map<string, number>,
  after: Map<string, number>,
  expectedRep: number
): { faction: string; delta: number } | null {
  let best: { faction: string; delta: number; distance: number } | null = null

  for (const faction of before.keys()) {
    if (faction === SHADOWS_OF_ANARCHY) continue

    const delta = (after.get(faction) ?? 0) - (before.get(faction) ?? 0)
    if (delta < 1) continue

    const distance = Math.abs(delta - expectedRep)
    if (!best || distance < best.distance) {
      best = { faction, delta, distance }
    }
  }

  return best ? { faction: best.faction, delta: best.delta } : null
}

function formatVictoryDeltaPercent(delta: number, expected: number): string {
  if (expected === 0) return "n/a"
  const percent = (delta / expected) * 100
  const shortfall = expected - delta
  return `${percent.toFixed(4)}% of expected (short by ${shortfall})`
}

/** Skip audit noise when payout is >= 99% of expected or overshoots. */
function shouldLogVictoryRewardShortfall(delta: number, expected: number): boolean {
  if (expected <= 0) return false
  return delta / expected < 0.99
}

function logVictoryRewardAudit(context: {
  intendedFaction: string | null
  intendedAction: VictorySubmitAction
  actualAction: VictorySubmitAction
  actualFaction: string | null
  dropdownAtSubmit: string
  factionStateAtSubmit: string
  expected: VictoryScreenRewards
  before: VictoryRewardSnapshot
  after: VictoryRewardSnapshot
  allFactionRepsBefore: Map<string, number>
  allFactionRepsAfter: Map<string, number>
}): void {
  const moneyDelta = context.after.money - context.before.money
  const factionDelta =
    context.before.factionRep != null && context.after.factionRep != null
      ? context.after.factionRep - context.before.factionRep
      : null

  if (context.actualAction === "sell") {
    if (
      context.intendedAction === "sell" &&
      context.expected.sellCash != null &&
      shouldLogVictoryRewardShortfall(moneyDelta, context.expected.sellCash)
    ) {
      console.log(
        "[infiltration victory] money shortfall:" +
          ` expected >= ${context.expected.sellCash},` +
          ` before ${context.before.money}, after ${context.after.money},` +
          ` delta ${moneyDelta} (${formatVictoryDeltaPercent(moneyDelta, context.expected.sellCash)})`
      )
    }
    if (context.intendedAction === "trade") {
      console.log(
        "[infiltration victory] intended trade but sold:" +
          ` wanted ${context.intendedFaction ?? "?"},` +
          ` dropdown "${context.dropdownAtSubmit}",` +
          ` factionName state "${context.factionStateAtSubmit}"`
      )
    }
    return
  }

  if (
    context.expected.tradeRep != null &&
    factionDelta != null &&
    shouldLogVictoryRewardShortfall(factionDelta, context.expected.tradeRep)
  ) {
    const recipient = findTradeRepRecipient(
      context.allFactionRepsBefore,
      context.allFactionRepsAfter,
      context.expected.tradeRep
    )
    const soaDelta =
      (context.allFactionRepsAfter.get(SHADOWS_OF_ANARCHY) ?? 0) -
      (context.allFactionRepsBefore.get(SHADOWS_OF_ANARCHY) ?? 0)
    const recipientNote = recipient
      ? `, closest trade-like gain ${recipient.faction} (+${recipient.delta})`
      : ", no faction gained trade-like rep"
    const infiltratorNote =
      soaDelta > 1 ? `, ${SHADOWS_OF_ANARCHY} infiltrator bonus +${soaDelta}` : ""

    console.log(
      "[infiltration victory] faction rep shortfall:" +
        ` audited ${context.actualFaction ?? "?"},` +
        ` expected >= ${context.expected.tradeRep},` +
        ` before ${context.before.factionRep}, after ${context.after.factionRep},` +
        ` delta ${factionDelta} (${formatVictoryDeltaPercent(factionDelta, context.expected.tradeRep)}),` +
        ` dropdown "${context.dropdownAtSubmit}",` +
        ` factionName state "${context.factionStateAtSubmit}"` +
        recipientNote +
        infiltratorNote
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
    factionStateAtSubmit: string
    expected: VictoryScreenRewards
    before: VictoryRewardSnapshot
    allFactionRepsBefore: Map<string, number>
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
    logVictoryRewardAudit({
      ...audit,
      after,
      allFactionRepsAfter: snapshotAllFactionReps(ns),
    })
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
  const allFactionRepsBefore = snapshotAllFactionReps(ns)
  const intendedAction: VictorySubmitAction = faction != null ? "trade" : "sell"
  const auditBase = {
    intendedFaction: faction,
    intendedAction,
    expected,
    before,
    allFactionRepsBefore,
  }

  ns.print(`Victory reward: selecting in ${VICTORY_REWARD_SELECT_DELAY_MS / 1000}s`)
  await ns.sleep(VICTORY_REWARD_SELECT_DELAY_MS)

  if (faction) {
    for (let attempt = 0; attempt < 3 && !isVictoryFactionReadyForTrade(faction); attempt++) {
      const selected = await invokeVictorySelectChange(ns, faction)
      const state = readVictoryFactionState() ?? "?"
      const dropdown = getVictoryComboboxDisplayValue() || "none"
      const stateOk = state === faction
      ns.print(
        `Victory reward: set ${faction} attempt ${attempt + 1}` +
          ` (${selected ? "handler ok" : "handler pending"}, useState "${state}"${stateOk ? "" : " MISMATCH"}, display "${dropdown}")`
      )
      await ns.sleep(VICTORY_STATE_SETTLE_MS)
    }

    if (!isVictoryFactionReadyForTrade(faction)) {
      const state = readVictoryFactionState() ?? "?"
      const dropdown = getVictoryComboboxDisplayValue() || "none"
      return {
        ok: false,
        detail: `faction state not ready (wanted ${faction}, state "${state}", dropdown "${dropdown}")`,
      }
    }

    ns.print(
      `Victory reward: useState ready for ${faction} (display "${getVictoryComboboxDisplayValue() || "none"}"), waiting for Trade handler commit`
    )
    await ns.sleep(VICTORY_REWARD_CONFIRM_DELAY_MS)
    if (!(await waitForVictoryTradeButtonCommit(ns, faction))) {
      return {
        ok: false,
        detail: `Trade button handler not committed for ${faction}`,
      }
    }

    const dropdownAtSubmit = getVictoryComboboxDisplayValue() || "none"
    const factionStateAtSubmit = readVictoryFactionState() ?? ""
    const traded = clickVictoryButton("Trade for")
    if (traded.ok) {
      return confirmVictoryReward(ns, `traded for ${faction} reputation`, {
        ...auditBase,
        actualAction: "trade",
        actualFaction: faction,
        dropdownAtSubmit,
        factionStateAtSubmit,
      })
    }
    return traded
  }

  if (isInfiltrationMoneyMode(ns)) {
    ns.print("Victory reward: money mode; will sell for money")
  } else {
    ns.print("Victory reward: no faction needs reputation; will sell for money")
  }

  await ns.sleep(VICTORY_REWARD_CONFIRM_DELAY_MS)
  const dropdownAtSubmit = getVictoryComboboxDisplayValue() || "none"
  const factionStateAtSubmit = readVictoryFactionState() ?? ""
  const sold = clickVictoryButton("Sell for")
  if (sold.ok) {
    return confirmVictoryReward(ns, "sold for money", {
      ...auditBase,
      actualAction: "sell",
      actualFaction: null,
      dropdownAtSubmit,
      factionStateAtSubmit,
    })
  }
  return sold
}
