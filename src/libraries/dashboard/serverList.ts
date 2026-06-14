import { NS } from "@ns"
import { crawl, isDarknetServer } from "../crawl"
import { createStandardContainer, FloatingWindow } from "../floatingWindow"
import { isAtMinSecurity } from "../removeSecurity.js"
import { formatTableRow, getTableBorders } from "../tableBuilder"

function formatServerListSecurity(ns: NS, hostname: string): string {
  if (isDarknetServer(hostname)) return "-"
  const minSec = ns.getServerMinSecurityLevel(hostname)
  const currentSec = ns.getServerSecurityLevel(hostname)
  const value = currentSec.toFixed(2)
  return isAtMinSecurity(currentSec, minSec) ? `M ${value}` : value
}

interface ServerListWindow {
  window: any
  container: HTMLElement
}

export function createServerListWindow(
  ns: NS,
  primaryColor: string,
  position?: { x: number; y: number },
  isCollapsed?: boolean
): ServerListWindow {
  const containerDiv = createStandardContainer(primaryColor)

  const window = new FloatingWindow({
    title: "Server List",
    content: containerDiv,
    id: "server-list-window",
    x: position?.x ?? 50,
    y: position?.y ?? 50,
  })

  // Toggle to collapsed state if needed
  if (isCollapsed) {
    window.toggle()
  }

  return { window, container: containerDiv }
}

function formatNumber(ns: NS, num: number = 0): string {
  return num < 1000 ? ns.format.number(num) + " " : ns.format.number(num)
}

function tFormat(time: number = 0): { html: string; length: number } {
  const totalSeconds = Math.floor(time / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const h = hours.toString().padStart(2, "0")
  const m = minutes.toString().padStart(2, "0")
  const s = seconds.toString().padStart(2, "0")

  // Build the full string
  const fullTime = `${h}:${m}:${s}`

  // Find the first non-zero digit
  let firstNonZeroIndex = -1
  for (let i = 0; i < fullTime.length; i++) {
    if (fullTime[i] !== "0" && fullTime[i] !== ":") {
      firstNonZeroIndex = i
      break
    }
  }

  // If all zeros (or no non-zero found), grey out everything except last digit
  if (firstNonZeroIndex === -1) {
    firstNonZeroIndex = fullTime.length - 1
  }

  // Split into grey and normal parts
  const greyPart = fullTime.substring(0, firstNonZeroIndex)
  const normalPart = fullTime.substring(firstNonZeroIndex)

  return {
    html: greyPart ? `<span style="color:#44444400">${greyPart}</span>${normalPart}` : fullTime,
    length: 8, // Always 8 characters visually: HH:MM:SS
  }
}

export function updateServerList(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
  const knownServers = new Set(crawl(ns))
  if (ns.hasTorRouter()) {
    knownServers.add("darkweb")
  }
  const player = ns.getPlayer()

  // Build server data with nuking
  let items = new Map<string, { level: number | null; server: any }>()
  for (const key of knownServers) {
    if (!key.includes("node") && !key.includes("hacknet") && key !== "home") {
      const level = isDarknetServer(key) ? null : ns.getServerRequiredHackingLevel(key)
      items.set(key, { level, server: ns.getServer(key) })
    }
  }

  // Sort by hacking level; darknet hosts last
  items = new Map(
    [...items].sort((a, b) => {
      const levelA = a[1].level ?? Number.POSITIVE_INFINITY
      const levelB = b[1].level ?? Number.POSITIVE_INFINITY
      return levelA - levelB || a[0].localeCompare(b[0])
    })
  )

  // Calculate column widths
  const nameCol = "Server"
  const lvlCol = "Level"
  const rootCol = "R"
  const backdoorCol = "B"
  const secCol = "Security"
  const ramCol = "RAM"
  const moneyCol = "Money"
  const timeCol = "Time"

  let nameLen = nameCol.length
  let lvlLen = lvlCol.length
  let rootLen = rootCol.length
  let backdoorLen = backdoorCol.length
  let secLen = secCol.length
  let ramLen = ramCol.length
  let moneyLen = moneyCol.length
  let timeLen = timeCol.length

  for (const [target, { level, server }] of items) {
    nameLen = Math.max(nameLen, target.length)
    lvlLen = Math.max(lvlLen, level === null ? 1 : (level.toString() + " X").length)
    rootLen = Math.max(rootLen, 1)
    backdoorLen = Math.max(backdoorLen, 1)
    secLen = Math.max(secLen, formatServerListSecurity(ns, target).length)
    ramLen = Math.max(ramLen, ns.format.ram(server.maxRam, 0).length)
    moneyLen = Math.max(moneyLen, formatNumber(ns, server.moneyMax).length)
    timeLen = Math.max(timeLen, 8) // tFormat always returns 8 characters visually
  }

  // Build table
  const colWidths = [nameLen, lvlLen, rootLen, backdoorLen, secLen, ramLen, moneyLen, timeLen]
  const borders = getTableBorders(colWidths)

  const headerCells = [
    nameCol.padEnd(nameLen),
    lvlCol.padStart(lvlLen),
    rootCol.padStart(rootLen),
    backdoorCol.padStart(backdoorLen),
    secCol.padStart(secLen),
    ramCol.padStart(ramLen),
    moneyCol.padStart(moneyLen),
    timeCol.padStart(timeLen),
  ]

  // Clear and rebuild container
  containerDiv.innerHTML = ""

  // Add header
  const headerSpan = document.createElement("span")
  headerSpan.textContent = `${borders.top()}\n${formatTableRow(headerCells)}\n${borders.header()}\n`
  containerDiv.appendChild(headerSpan)

  // Add rows
  for (const [target, { level, server }] of items) {
    const levelDisplay = level === null ? "-" : `${level} ${level <= player.skills.hacking ? " " : "X"}`
    const hasRoot = server.hasAdminRights ? " " : "X"
    const hasBackdoor = server.backdoorInstalled ? " " : "X"
    const secDisplay = formatServerListSecurity(ns, target)
    const ram = ns.format.ram(server.maxRam, 0)
    const money = formatNumber(ns, server.moneyMax ?? 0)
    const timeFormatted = isDarknetServer(target)
      ? { html: "-".padStart(timeLen), length: timeLen }
      : tFormat(ns.getWeakenTime(target))

    // Pad the time HTML to the correct width by adding leading spaces
    const timePadding = " ".repeat(Math.max(0, timeLen - timeFormatted.length))
    const timePadded = timePadding + timeFormatted.html

    const rowSpan = document.createElement("span")
    rowSpan.innerHTML = formatTableRow([
      target.padEnd(nameLen),
      levelDisplay.padStart(lvlLen),
      hasRoot.padStart(rootLen),
      hasBackdoor.padStart(backdoorLen),
      secDisplay.padStart(secLen),
      ram.padStart(ramLen),
      money.padStart(moneyLen),
      timePadded,
    ])
    rowSpan.innerHTML += "\n"
    containerDiv.appendChild(rowSpan)
  }

  // Add footer
  const footerSpan = document.createElement("span")
  footerSpan.textContent = borders.bottom()
  containerDiv.appendChild(footerSpan)
}
