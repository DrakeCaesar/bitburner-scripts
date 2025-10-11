import { NS } from "@ns"
import { createAugmentsWindow, updateAugmentsView } from "./libraries/dashboard/augments.js"
import { createNodesWindow, updateNodesView } from "./libraries/dashboard/nodes.js"
import { createServerListWindow, updateServerList } from "./libraries/dashboard/serverList.js"

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
  const existingServerList = eval("document").querySelector("#server-list-window")
  if (existingServerList) existingServerList.remove()

  const existingNodes = eval("document").querySelector("#nodes-window")
  if (existingNodes) existingNodes.remove()

  const existingTargets = eval("document").querySelector("#target-analysis-window")
  if (existingTargets) existingTargets.remove()

  const existingAugments = eval("document").querySelector("#augments-window")
  if (existingAugments) existingAugments.remove()

  // Extract primary text color from game's CSS (do this once)
  const primaryElement = eval("document").querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = eval("window").getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create all four windows
  const serverListWindow = createServerListWindow(ns, primaryColor)
  const nodesWindow = createNodesWindow(ns, primaryColor)
  // const targetsWindow = createTargetsWindow(ns, primaryColor)
  const augmentsWindow = createAugmentsWindow(ns, primaryColor)

  // Update loop - refresh all views every second
  while (true) {
    updateServerList(ns, serverListWindow.container, primaryColor)
    updateNodesView(ns, nodesWindow.container, primaryColor)
    // updateTargetsView(ns, targetsWindow.container, primaryColor)
    updateAugmentsView(ns, augmentsWindow.container, primaryColor)
    await ns.sleep(1000)
  }
}
