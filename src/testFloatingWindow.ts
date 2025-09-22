import { NS } from "@ns"
import { FloatingWindow } from "./floatingWindow.js"

export async function main(ns: NS) {
  // Content for the test window
  const testContent =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."

  // Find the #root element
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    return
  }

  // Remove existing floating window if it exists
  const existingWindow = document.getElementById("floating")
  if (existingWindow) {
    existingWindow.remove()
  }

  // Create a floating window that will automatically position itself next to the overview container
  const window = new FloatingWindow({
    title: "Title",
    content: testContent,
    width: 400,
    height: 300,
    id: "floating",
  })

  // Keep the script running until the window is closed
  while (window.getElement()?.parentNode) {
    await ns.sleep(1000)
  }
}
