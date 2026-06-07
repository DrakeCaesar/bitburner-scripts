import { invokeInfiltrateCompanyButton, invokeStartInfiltration } from "./infiltrationGameBridge.js"

const SIDEBAR_CITY_PAGE = "City"
const INFILTRATE_BUTTON = "Infiltrate Company"
const START_BUTTON = "Start"

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function clickElement(element: HTMLElement): void {
  element.click()
}

function findSidebarPageLink(pageName: string): HTMLElement | null {
  for (const item of Array.from(document.querySelectorAll(".MuiListItem-root"))) {
    for (const label of Array.from(item.querySelectorAll(".MuiTypography-root"))) {
      if (normalizeText(label.textContent ?? "") === pageName) {
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

function findLocationElement(locationName: string): HTMLElement | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") === locationName) {
      return button
    }
  }

  const labeled = document.querySelector(`span[aria-label="${locationName}"]`)
  if (labeled instanceof HTMLElement) {
    return labeled
  }

  return null
}

export function openCityPage(): boolean {
  const link = findSidebarPageLink(SIDEBAR_CITY_PAGE)
  if (!link) return false
  clickElement(link)
  return true
}

export function clickCityLocation(locationName: string): boolean {
  const element = findLocationElement(locationName)
  if (!element) return false
  clickElement(element)
  return true
}

export function clickInfiltrateCompany(locationName: string): { ok: boolean; detail: string } {
  return invokeInfiltrateCompanyButton(locationName)
}

export function clickStartInfiltration(): boolean {
  const result = invokeStartInfiltration()
  if (result.ok) return true

  const button = findButtonByLabel(START_BUTTON)
  if (!button || button.disabled) return false
  clickElement(button)
  return true
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

export function isInfiltrationActive(): boolean {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    const label = normalizeText(button.textContent ?? "")
    if (label.startsWith("Cancel Infiltration")) {
      return true
    }
  }
  return false
}

export interface VisitInfiltrationDomResult {
  ok: boolean
  step: string
  detail?: string
}

/** Navigate the World UI to a company and open the infiltration intro screen. */
export function visitInfiltrationTargetDom(locationName: string): VisitInfiltrationDomResult {
  if (isInfiltrationActive()) {
    return { ok: true, step: "already active", detail: locationName }
  }

  if (isOnInfiltrationIntro(locationName)) {
    if (clickStartInfiltration()) {
      return { ok: true, step: "started", detail: locationName }
    }
    return { ok: true, step: "intro ready", detail: locationName }
  }

  if (findButtonByLabel(INFILTRATE_BUTTON)) {
    const opened = clickInfiltrateCompany(locationName)
    if (!opened.ok) {
      return { ok: false, step: "infiltrate open failed", detail: opened.detail }
    }
    return { ok: true, step: "opened intro", detail: locationName }
  }

  if (findLocationElement(locationName)) {
    if (!clickCityLocation(locationName)) {
      return { ok: false, step: "location click failed", detail: locationName }
    }
    return { ok: true, step: "opened location", detail: locationName }
  }

  if (!openCityPage()) {
    return { ok: false, step: "city sidebar missing", detail: SIDEBAR_CITY_PAGE }
  }

  return { ok: true, step: "opened city page", detail: locationName }
}
