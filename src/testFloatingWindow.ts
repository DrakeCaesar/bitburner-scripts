import { NS } from "@ns"
import { FloatingWindow } from "./libraries/floatingWindow.js"

export async function main(ns: NS) {
  // Content for the test window
  const testContent =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."

  // Find the #root element
  const rootElement = document.getElementById("root")
  if (!rootElement) {
    return
  }

  // Remove existing floating windows if they exist
  const existingWindows = document.querySelectorAll(".floating")
  existingWindows.forEach((window) => window.remove())

  // Create a floating window that will automatically position itself next to the overview container
  const window = new FloatingWindow({
    title: "Test Window",
    content: testContent,
    width: 400,
    height: 300,
    id: "floating-test-1",
  })
}
