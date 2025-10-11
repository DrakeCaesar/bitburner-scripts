import { NS } from "@ns"
import { createAugmentsWindow, updateAugmentsView } from "./libraries/dashboard/augments.js"
import { createNodesWindow, updateNodesView } from "./libraries/dashboard/nodes.js"
import { createServerListWindow, updateServerList } from "./libraries/dashboard/serverList.js"
import { formatNumber } from "./libraries/format.js"

/**
 * Unified Dashboard Script
 * Combines server list, purchased nodes, and augments views into one script
 * Reduces RAM usage by only accessing document/window once
 */
export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName()
  const hostname = ns.getHostname()
  const processes = ns.ps(hostname)

  // Kill any other instances of this script
  for (const proc of processes) {
    if (proc.filename === scriptName && proc.pid !== ns.pid) {
      ns.kill(proc.pid)
    }
  }

  // Remove existing windows if they exist
  const existingServerList = document.querySelector("#server-list-window")
  if (existingServerList) existingServerList.remove()

  const existingNodes = document.querySelector("#nodes-window")
  if (existingNodes) existingNodes.remove()

  const existingTargets = document.querySelector("#target-analysis-window")
  if (existingTargets) existingTargets.remove()

  const existingAugments = document.querySelector("#augments-window")
  if (existingAugments) existingAugments.remove()

  // Extract primary text color from game's CSS (do this once)
  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = window.getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create all four windows
  const serverListWindow = createServerListWindow(ns, primaryColor)
  const nodesWindow = createNodesWindow(ns, primaryColor)
  // const targetsWindow = createTargetsWindow(ns, primaryColor)
  const augmentsWindow = createAugmentsWindow(ns, primaryColor)

  // Get overview hooks for karma/stats display
  const hook0 = document.getElementById("overview-extra-hook-0")
  const hook1 = document.getElementById("overview-extra-hook-1")

  // Update loop - refresh all views every second
  while (true) {
    try {
      // Update floating windows
      updateServerList(ns, serverListWindow.container, primaryColor)
      updateNodesView(ns, nodesWindow.container, primaryColor)
      // updateTargetsView(ns, targetsWindow.container, primaryColor)
      updateAugmentsView(ns, augmentsWindow.container, primaryColor)

      if (hook0 && hook1) {
        const karma = ns.heart.break()

        const headers = []
        const values = []

        headers.push("Kar")
        values.push(formatNumber(karma))

        headers.push("Exp")
        values.push(formatNumber(ns.getTotalScriptExpGain()))

        headers.push("Mon")
        values.push(formatNumber(ns.getTotalScriptIncome()[0]))

        hook0.innerText = headers.join(" \n")
        hook1.innerText = values.join("\n")
        hook1.style.whiteSpace = "pre-wrap"
      }
    } catch (err) {
      ns.print("ERROR: Update Skipped: " + String(err))
    }

    await ns.sleep(1000)
  }
}
