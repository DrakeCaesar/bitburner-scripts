import { NS } from "@ns"
import { crawl } from "./libraries/crawl.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"

export function main(ns: NS) {
  // Remove existing list window if it exists
  const existingWindow = document.querySelector("#server-list-window")
  if (existingWindow) {
    existingWindow.remove()
  }

  const knownServers = crawl(ns)
  const player = ns.getPlayer()

  // Build server data with nuking
  let items = new Map<string, { level: number; server: any }>()
  for (const key of knownServers) {
    if (!key.includes("node")) {
      const level = ns.getServerRequiredHackingLevel(key)
      const server = ns.getServer(key)

      // Attempt to nuke if possible
      let numPortsOpen = 0
      if (ns.fileExists("BruteSSH.exe", "home")) {
        ns.brutessh(key)
        ++numPortsOpen
      }
      if (ns.fileExists("FTPCrack.exe", "home")) {
        ns.ftpcrack(key)
        ++numPortsOpen
      }
      if (ns.fileExists("relaySMTP.exe", "home")) {
        ns.relaysmtp(key)
        ++numPortsOpen
      }
      if (ns.fileExists("HTTPWorm.exe", "home")) {
        ns.httpworm(key)
        ++numPortsOpen
      }
      if (ns.fileExists("SQLInject.exe", "home")) {
        ns.sqlinject(key)
        ++numPortsOpen
      }
      if (
        ns.fileExists("NUKE.exe", "home") &&
        level <= player.skills.hacking &&
        ns.getServerNumPortsRequired(key) <= numPortsOpen
      ) {
        ns.nuke(key)
      }

      // Re-get server to get updated root status
      items.set(key, { level, server: ns.getServer(key) })
    }
  }

  // Sort by hacking level
  items = new Map([...items].sort((a, b) => a[1].level - b[1].level))

  // Column headers
  const serverCol = "Server"
  const lvlCol = "Level"
  const rootCol = "Root"
  const backdoorCol = "BD"
  const secCol = "Security"
  const ramCol = "RAM"
  const moneyCol = "Money"
  const timeCol = "Time"

  // Calculate column widths
  let serverLen = serverCol.length
  let lvlLen = lvlCol.length
  let rootLen = rootCol.length
  let backdoorLen = backdoorCol.length
  let secLen = secCol.length
  let ramLen = ramCol.length
  let moneyLen = moneyCol.length
  let timeLen = timeCol.length

  for (const [target, { level, server }] of items) {
    serverLen = Math.max(serverLen, target.length)
    lvlLen = Math.max(lvlLen, level.toString().length)
    rootLen = Math.max(rootLen, (server.hasAdminRights ? "" : "X").length)
    backdoorLen = Math.max(backdoorLen, (server.backdoorInstalled ? "" : "X").length)
    secLen = Math.max(secLen, ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2).length)
    ramLen = Math.max(ramLen, ns.formatRam(server.maxRam).length)
    moneyLen = Math.max(moneyLen, ns.formatNumber(server.moneyMax ?? 0).length)
    timeLen = Math.max(timeLen, ns.tFormat(ns.getWeakenTime(target)).length)
  }

  // Build table with box-drawing characters
  let tableRows = ""
  for (const [target, { level, server }] of items) {
    const hackable = level <= player.skills.hacking ? " " : "X"
    const hasRoot = server.hasAdminRights ? " " : "X"
    const hasBackdoor = server.backdoorInstalled ? " " : "X"
    const secDiff = ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2).padStart(secLen)
    const ram = ns.formatRam(server.maxRam).padStart(ramLen)
    const money = ns.formatNumber(server.moneyMax ?? 0).padStart(moneyLen)
    const time = ns.tFormat(ns.getWeakenTime(target)).padStart(timeLen)

    tableRows += `┃ ${target.padEnd(serverLen)} ┃ ${level.toString().padStart(lvlLen)} ${hackable} ┃ ${hasRoot.padStart(rootLen)} ┃ ${hasBackdoor.padStart(backdoorLen)} ┃ ${secDiff} ┃ ${ram} ┃ ${money} ┃ ${time} ┃\n`
  }

  const fullTable =
    `┏━${"━".repeat(serverLen)}━┳━${"━".repeat(lvlLen + 2)}━┳━${"━".repeat(rootLen)}━┳━${"━".repeat(backdoorLen)}━┳━${"━".repeat(secLen)}━┳━${"━".repeat(ramLen)}━┳━${"━".repeat(moneyLen)}━┳━${"━".repeat(timeLen)}━┓\n` +
    `┃ ${serverCol.padEnd(serverLen)} ┃ ${lvlCol.padStart(lvlLen + 2)} ┃ ${rootCol.padStart(rootLen)} ┃ ${backdoorCol.padStart(backdoorLen)} ┃ ${secCol.padStart(secLen)} ┃ ${ramCol.padStart(ramLen)} ┃ ${moneyCol.padStart(moneyLen)} ┃ ${timeCol.padStart(timeLen)} ┃\n` +
    `┣━${"━".repeat(serverLen)}━╋━${"━".repeat(lvlLen + 2)}━╋━${"━".repeat(rootLen)}━╋━${"━".repeat(backdoorLen)}━╋━${"━".repeat(secLen)}━╋━${"━".repeat(ramLen)}━╋━${"━".repeat(moneyLen)}━╋━${"━".repeat(timeLen)}━┫\n` +
    `${tableRows}` +
    `┗━${"━".repeat(serverLen)}━┻━${"━".repeat(lvlLen + 2)}━┻━${"━".repeat(rootLen)}━┻━${"━".repeat(backdoorLen)}━┻━${"━".repeat(secLen)}━┻━${"━".repeat(ramLen)}━┻━${"━".repeat(moneyLen)}━┻━${"━".repeat(timeLen)}━┛`

  // Extract primary text color from game's CSS
  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = window.getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create pre element for monospace formatting
  const pre = document.createElement("pre")
  pre.style.margin = "0"
  pre.style.fontFamily = "monospace"
  pre.style.fontSize = "12px"
  pre.style.whiteSpace = "pre"
  pre.style.lineHeight = "1.2"
  pre.style.color = primaryColor
  pre.style.overflow = "auto"
  pre.textContent = fullTable

  // Calculate content width based on longest line (approximate)
  const lines = fullTable.split("\n")
  const maxLineLength = Math.max(...lines.map((line) => line.length))
  // Approximate character width: 7.2px per character for 12px monospace font
  const contentWidth = Math.min(maxLineLength * 7.2 + 40, window.innerWidth - 100)

  // Create floating window
  new FloatingWindow({
    title: `Server List (${items.size} servers)`,
    content: pre,
    width: contentWidth,
    height: 600,
    id: "server-list-window",
  })
}
