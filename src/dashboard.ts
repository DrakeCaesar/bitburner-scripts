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

  // Check for existing windows and preserve their positions
  const existingServerList = document.querySelector("#server-list-window") as HTMLElement
  const existingNodes = document.querySelector("#nodes-window") as HTMLElement
  const existingTargets = document.querySelector("#target-analysis-window") as HTMLElement
  const existingAugments = document.querySelector("#augments-window") as HTMLElement

  // Extract positions and collapsed state from existing windows
  const getPosition = (element: HTMLElement | null): { x: number; y: number } | null => {
    if (!element) return null
    const style = window.getComputedStyle(element)
    const matrix = new DOMMatrix(style.transform)
    return { x: matrix.m41 || 0, y: matrix.m42 || 0 }
  }

  const getCollapsedState = (element: HTMLElement | null): boolean => {
    if (!element) return false
    // Check if the content area has the collapsed class (without MuiCollapse-entered)
    const contentArea = element.querySelector('[class*="MuiCollapse-root"]')
    if (!contentArea) return false
    return !contentArea.classList.contains("MuiCollapse-entered")
  }

  const serverListPos = getPosition(existingServerList)
  const nodesPos = getPosition(existingNodes)
  const augmentsPos = getPosition(existingAugments)

  const serverListCollapsed = getCollapsedState(existingServerList)
  const nodesCollapsed = getCollapsedState(existingNodes)
  const augmentsCollapsed = getCollapsedState(existingAugments)

  // Remove existing windows
  if (existingServerList) existingServerList.remove()
  if (existingNodes) existingNodes.remove()
  if (existingTargets) existingTargets.remove()
  if (existingAugments) existingAugments.remove()

  // Extract primary text color from game's CSS (do this once)
  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = window.getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create all windows with preserved positions and collapsed states
  const serverListWindow = createServerListWindow(ns, primaryColor, serverListPos ?? undefined, serverListCollapsed)
  const nodesWindow = createNodesWindow(ns, primaryColor, nodesPos ?? undefined, nodesCollapsed)
  // const targetsWindow = createTargetsWindow(ns, primaryColor)
  const augmentsWindow = createAugmentsWindow(ns, primaryColor, augmentsPos ?? undefined, augmentsCollapsed)

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
