import { NS } from "@ns"
import { FloatingWindow } from "./floatingWindow.js"

export async function main(ns: NS) {
  // Content for the test window
  const testContent = "window"

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
    title: "title",
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
