import type { NS } from "@ns"
import { waitForCityNavigationReady } from "./infiltrationNavigation.js"

const VICTORY_TITLE = "Infiltration successful!"

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
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

/** Always sell infiltration rewards for cash (no faction rep trade). */
export async function collectInfiltrationVictoryRewardMoney(
  ns: NS
): Promise<{ ok: boolean; detail: string }> {
  if (!isInfiltrationVictoryScreen()) {
    return { ok: false, detail: "not on victory screen" }
  }

  ns.print("Victory reward: sell for money")
  const sold = clickVictoryButton("Sell for")
  if (!sold.ok) {
    return sold
  }

  if (!(await waitForCityNavigationReady(ns))) {
    return { ok: false, detail: "sold for money (UI did not close)" }
  }

  return { ok: true, detail: "sold for money" }
}
