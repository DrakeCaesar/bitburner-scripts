import type { NS } from "@ns"
import { getPreferredFactionForRep, parseFactionWorkPriority } from "../factionWork.js"
import { getInfiltrationRewardGoal, isInfiltrationMoneyMode } from "./infiltrationTargets.js"
import { findButtonByTextPrefix, invokeTrustedClick } from "./infiltrationGameBridge.js"
import { waitForCityNavigationReady } from "./infiltrationNavigation.js"

const VICTORY_TITLE = "Infiltration successful!"
const VICTORY_REWARD_SELECT_DELAY_MS = 500
const VICTORY_REWARD_CONFIRM_DELAY_MS = 500

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

type ReactFiberLike = {
  memoizedProps?: Record<string, unknown>
  pendingProps?: Record<string, unknown>
  return?: ReactFiberLike | null
}

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

async function confirmVictoryReward(
  ns: NS,
  detail: string
): Promise<{ ok: boolean; detail: string }> {
  if (!(await waitForCityNavigationReady(ns))) {
    return { ok: false, detail: `${detail} (UI did not close)` }
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
      const traded = clickVictoryButton("Trade for")
      if (traded.ok) {
        return confirmVictoryReward(ns, `traded for ${faction} reputation`)
      }
    }
  }

  const sold = clickVictoryButton("Sell for")
  if (sold.ok) {
    return confirmVictoryReward(ns, "sold for money")
  }
  return sold
}
