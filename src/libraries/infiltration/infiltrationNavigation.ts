import {
  invokeInfiltrateCompanyButton,
  invokeStartInfiltration,
  invokeTrustedClick,
} from "./infiltrationGameBridge.js"
import type { LocationName, NS } from "@ns"

const SIDEBAR_CITY_PAGE = "City"
const VICTORY_TITLE = "Infiltration successful!"
const NAV_READY_POLL_MS = 200
const DEFAULT_NAV_READY_TIMEOUT_MS = 15000
const INFILTRATE_BUTTON = "Infiltrate Company"
const CANCEL_INTRO_BUTTON = "Cancel"

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function findSidebarPageLink(pageName: string): HTMLElement | null {
  for (const item of Array.from(document.querySelectorAll(".MuiListItem-root"))) {
    for (const label of Array.from(item.querySelectorAll(".MuiTypography-root"))) {
      if (normalizeText(label.textContent ?? "") === pageName && item instanceof HTMLElement) {
        return item
      }
    }
  }
  return null
}

function findButtonByLabel(label: string): HTMLButtonElement | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") === label) {
      return button
    }
  }
  return null
}

function openCityPage(): boolean {
  const link = findSidebarPageLink(SIDEBAR_CITY_PAGE)
  if (!link) return false
  link.click()
  return true
}

function goToCompanyLocation(ns: NS, locationName: string): boolean {
  return ns.singularity.goToLocation(locationName as LocationName)
}

export function clickStartInfiltration(): boolean {
  return invokeStartInfiltration().ok
}

export function isOnInfiltrationIntro(locationName: string): boolean {
  for (const heading of Array.from(document.querySelectorAll("h4"))) {
    const text = normalizeText(heading.textContent ?? "")
    if (text.startsWith("Infiltrating") && text.includes(locationName)) {
      return true
    }
  }
  return false
}

export function isOnAnyInfiltrationIntro(): boolean {
  for (const heading of Array.from(document.querySelectorAll("h4"))) {
    if (normalizeText(heading.textContent ?? "").startsWith("Infiltrating")) {
      return true
    }
  }

  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") !== CANCEL_INTRO_BUTTON) continue
    if (button.closest(".MuiContainer-root")) {
      return true
    }
  }

  return false
}

function findCancelIntroButton(): HTMLButtonElement | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") !== CANCEL_INTRO_BUTTON) continue
    if (button.closest(".MuiContainer-root")) {
      return button
    }
  }
  return null
}

/** Leave the intro screen without starting the run. */
export function clickCancelInfiltrationIntro(): boolean {
  const button = findCancelIntroButton()
  if (!button) return false
  return invokeTrustedClick(button)
}

/** Return to the city map between visit checks. */
export function resetToCityForNextVisit(): boolean {
  if (isOnAnyInfiltrationIntro()) {
    clickCancelInfiltrationIntro()
  }
  return openCityPage()
}

export function isInfiltrationActive(): boolean {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    const label = normalizeText(button.textContent ?? "")
    if (label.startsWith("Cancel Infiltration")) {
      return true
    }
  }
  return false
}

export function isCitySidebarAvailable(): boolean {
  return findSidebarPageLink(SIDEBAR_CITY_PAGE) !== null
}

function isInfiltrationVictoryScreenVisible(): boolean {
  for (const heading of Array.from(document.querySelectorAll("h4"))) {
    if (normalizeText(heading.textContent ?? "") === VICTORY_TITLE) {
      return true
    }
  }
  return false
}

export function isInfiltrationUiBlockingNavigation(): boolean {
  return isInfiltrationVictoryScreenVisible() || isInfiltrationActive() || isOnAnyInfiltrationIntro()
}

/** Wait for victory/infiltration UI to close and the City sidebar to be usable again. */
export async function waitForCityNavigationReady(
  ns: NS,
  timeoutMs = DEFAULT_NAV_READY_TIMEOUT_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!isInfiltrationUiBlockingNavigation() && isCitySidebarAvailable()) {
      openCityPage()
      await ns.sleep(NAV_READY_POLL_MS)
      return isCitySidebarAvailable()
    }
    await ns.sleep(NAV_READY_POLL_MS)
  }

  return !isInfiltrationUiBlockingNavigation() && isCitySidebarAvailable()
}

export interface VisitInfiltrationDomResult {
  ok: boolean
  step: string
  detail?: string
}

function visitInfiltrationIntro(ns: NS, locationName: string, startRun: boolean): VisitInfiltrationDomResult {
  if (isInfiltrationActive()) {
    return startRun
      ? { ok: true, step: "already active", detail: locationName }
      : { ok: false, step: "infiltration active", detail: locationName }
  }

  if (isOnInfiltrationIntro(locationName)) {
    if (startRun && clickStartInfiltration()) {
      return { ok: true, step: "started", detail: locationName }
    }
    return { ok: true, step: "intro ready", detail: locationName }
  }

  if (findButtonByLabel(INFILTRATE_BUTTON)) {
    const opened = invokeInfiltrateCompanyButton()
    if (!opened.ok) {
      return { ok: false, step: "infiltrate open failed", detail: opened.detail }
    }
    return { ok: true, step: "opened intro", detail: locationName }
  }

  if (goToCompanyLocation(ns, locationName)) {
    return { ok: true, step: "opened company", detail: locationName }
  }

  return { ok: false, step: "go to location failed", detail: locationName }
}

/** Navigate to the company, open intro, and start the run when already on intro. */
export function visitInfiltrationTargetDom(ns: NS, locationName: string): VisitInfiltrationDomResult {
  return visitInfiltrationIntro(ns, locationName, true)
}

/** Navigate to the infiltration intro screen without starting the run. */
export function visitInfiltrationIntroDom(ns: NS, locationName: string): VisitInfiltrationDomResult {
  return visitInfiltrationIntro(ns, locationName, false)
}
