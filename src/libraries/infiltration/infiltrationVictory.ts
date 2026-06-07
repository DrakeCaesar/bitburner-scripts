import type { NS } from "@ns"
import { findButtonByTextPrefix, invokeTrustedClick } from "./infiltrationGameBridge.js"
import { waitForCityNavigationReady } from "./infiltrationNavigation.js"

const VICTORY_TITLE = "Infiltration successful!"
const VICTORY_REWARD_CONFIRM_DELAY_MS = 1000

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

function getSelectedVictoryFaction(): string {
  const select = getVictoryFactionSelect()
  if (!select) return ""
  return normalizeText(select.textContent ?? "")
}

function invokeVictorySelectChange(factionName: string): boolean {
  if (getSelectedVictoryFaction() === factionName) {
    return true
  }

  const select = getVictoryFactionSelect()
  if (!select) return false

  let fiber: ReactFiberLike | null = getReactFiber(select)
  const seen = new Set<ReactFiberLike>()

  while (fiber) {
    if (seen.has(fiber)) break
    seen.add(fiber)

    for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
      if (props && typeof props.onChange === "function") {
        ;(props.onChange as (event: { target: { value: string } }) => void)({
          target: { value: factionName },
        })
        return getSelectedVictoryFaction() === factionName
      }
    }

    fiber = fiber.return ?? null
  }

  invokeTrustedClick(select)
  for (const option of Array.from(document.querySelectorAll('[role="option"], .MuiMenuItem-root'))) {
    if (normalizeText(option.textContent ?? "") !== factionName) continue
    invokeTrustedClick(option as HTMLElement)
    return getSelectedVictoryFaction() === factionName
  }

  return getSelectedVictoryFaction() === factionName
}

export function getCurrentFactionWorkTarget(ns: NS): string | null {
  const work = ns.singularity.getCurrentWork()
  if (!work || work.type !== "FACTION") return null
  return work.factionName ?? null
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

  const faction = getCurrentFactionWorkTarget(ns)
  let rewardAction = "sell for money"
  if (faction) {
    invokeVictorySelectChange(faction)
    const selected = getSelectedVictoryFaction()
    if (selected === faction && selected !== "none") {
      rewardAction = `trade for ${faction} reputation`
    } else {
      ns.print(
        `Victory reward: faction work is ${faction}, dropdown shows "${selected || "none"}"; will sell for money`
      )
    }
  } else {
    ns.print("Victory reward: no faction work active; will sell for money")
  }

  ns.print(`Victory reward: confirming in ${VICTORY_REWARD_CONFIRM_DELAY_MS / 1000}s (${rewardAction})`)
  await ns.sleep(VICTORY_REWARD_CONFIRM_DELAY_MS)

  if (faction) {
    invokeVictorySelectChange(faction)
    const selected = getSelectedVictoryFaction()
    if (selected === faction && selected !== "none") {
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
