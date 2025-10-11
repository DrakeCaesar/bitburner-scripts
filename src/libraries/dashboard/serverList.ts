import { NS } from "@ns"
import { crawl } from "../crawl"
import { FloatingWindow } from "../floatingWindow"
import { formatTableRow, getTableBorders } from "../tableBuilder"

interface ServerListWindow {
  window: any
  container: HTMLElement
}

export function createServerListWindow(ns: NS, primaryColor: string): ServerListWindow {
  const containerDiv = document.createElement("div")
  containerDiv.style.fontFamily = "inherit"
  containerDiv.style.fontSize = "12px"
  containerDiv.style.whiteSpace = "pre"
  containerDiv.style.lineHeight = "1.2"
  containerDiv.style.color = primaryColor
  containerDiv.style.overflow = "auto"

  const window = new FloatingWindow({
    title: "Server List",
    content: containerDiv,
    width: 800,
    height: 600,
    id: "server-list-window",
    x: 50,
    y: 50,
  })

  return { window, container: containerDiv }
}

function formatNumber(ns: NS, num: number = 0): string {
  return num < 1000 ? ns.formatNumber(num) + " " : ns.formatNumber(num)
}

export function updateServerList(ns: NS, containerDiv: HTMLElement, primaryColor: string): void {
  const knownServers = crawl(ns)
  const player = ns.getPlayer()

  // Build server data with nuking
  let items = new Map<string, { level: number; server: any }>()
  for (const key of knownServers) {
    if (!key.includes("node") && key !== "home" && key !== "darkweb") {
      const level = ns.getServerRequiredHackingLevel(key)
      items.set(key, { level, server: ns.getServer(key) })
    }
  }

  // Sort by hacking level
  items = new Map([...items].sort((a, b) => a[1].level - b[1].level))

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
    lvlLen = Math.max(lvlLen, (level.toString() + " X").length)
    rootLen = Math.max(rootLen, 1)
    backdoorLen = Math.max(backdoorLen, 1)
    secLen = Math.max(secLen, ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2).length)
    ramLen = Math.max(ramLen, ns.formatRam(server.maxRam, 0).length)
    moneyLen = Math.max(moneyLen, formatNumber(ns, server.moneyMax).length)
    timeLen = Math.max(timeLen, ns.tFormat(ns.getWeakenTime(target)).length)
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
    const hackable = level <= player.skills.hacking ? " " : "X"
    const hasRoot = server.hasAdminRights ? " " : "X"
    const hasBackdoor = server.backdoorInstalled ? " " : "X"
    const secDiff = ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2)
    const ram = ns.formatRam(server.maxRam, 0)
    const money = formatNumber(ns, server.moneyMax ?? 0)
    const time = ns.tFormat(ns.getWeakenTime(target))

    const rowSpan = document.createElement("span")
    rowSpan.textContent = formatTableRow([
      target.padEnd(nameLen),
      `${level} ${hackable}`.padStart(lvlLen),
      hasRoot.padStart(rootLen),
      hasBackdoor.padStart(backdoorLen),
      secDiff.padStart(secLen),
      ram.padStart(ramLen),
      money.padStart(moneyLen),
      time.padStart(timeLen),
    ])
    rowSpan.textContent += "\n"
    containerDiv.appendChild(rowSpan)
  }

  // Add footer
  const footerSpan = document.createElement("span")
  footerSpan.textContent = borders.bottom()
  containerDiv.appendChild(footerSpan)
}
