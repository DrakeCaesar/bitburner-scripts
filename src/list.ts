import { NS } from "@ns"
import { crawl } from "./libraries/crawl.js"
import { FloatingWindow } from "./libraries/floatingWindow.js"
import { buildTable } from "./libraries/tableBuilder.js"

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

  // Build table using the table builder library
  const fullTable = buildTable({
    columns: [
      { header: "Server", align: "left" },
      { header: "Level", align: "right", minWidth: 7 }, // minWidth for "Level X" format
      { header: "Root", align: "right" },
      { header: "BD", align: "right" },
      { header: "Security", align: "right" },
      { header: "RAM", align: "right" },
      { header: "Money", align: "right" },
      { header: "Time", align: "right" },
    ],
    rows: Array.from(items).map(([target, { level, server }]) => {
      const hackable = level <= player.skills.hacking ? " " : "X"
      const hasRoot = server.hasAdminRights ? " " : "X"
      const hasBackdoor = server.backdoorInstalled ? " " : "X"
      const secDiff = ((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)).toFixed(2)
      const ram = ns.formatRam(server.maxRam)
      const money = ns.formatNumber(server.moneyMax ?? 0)
      const time = ns.tFormat(ns.getWeakenTime(target))

      return [target, `${level} ${hackable}`, hasRoot, hasBackdoor, secDiff, ram, money, time]
    }),
  })

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
  pre.style.fontFamily = "inherit"
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
