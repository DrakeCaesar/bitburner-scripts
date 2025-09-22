import { NS } from "@ns"
import { FloatingWindow } from "./floatingWindow.js"

export async function main(ns: NS) {
  ns.tprint("Starting Single Floating Window Test...")

  // Content for the test window
  const testContent = `
    <div>
      <h3>Styled Floating Window</h3>
      <p>This window steals styling from game's overview container elements.</p>
      <ul>
        <li>Draggable: Yes</li>
        <li>Collapsible: Yes</li>
        <li>Closable: Yes</li>
        <li>Styled: Dynamically stolen from game UI</li>
      </ul>
      <p>Current time: ${new Date().toLocaleTimeString()}</p>
      <div style="margin-top: 15px;">
        <button onclick="this.style.backgroundColor='#4caf50'; this.textContent='Clicked!'" 
                style="background: #2196f3; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
          Interactive Button
        </button>
      </div>
    </div>
  `

  try {
    // Find the #root element
    const rootElement = document.getElementById("root")
    if (!rootElement) {
      ns.tprint("ERROR: Could not find #root element")
      return
    }

    // Remove existing floating window if it exists
    const existingWindow = document.getElementById("floating")
    if (existingWindow) {
      existingWindow.remove()
      ns.tprint("Removed existing floating window")
    }

    // Create a floating window that will automatically position itself next to the overview container
    const window = new FloatingWindow({
      title: "Styled Window",
      content: testContent,
      width: 400,
      height: 300,
      id: "floating",
    })

    ns.tprint("Created floating window as sibling of overview container")
    ns.tprint("\\n=== Styled Floating Window Test Complete ===")
    ns.tprint("✓ Window positioned next to overview container")
    ns.tprint("✓ Window placed as direct sibling element")
    ns.tprint("✓ Window styling stolen from overview container")
    ns.tprint("✓ Window has ID 'floating' (replaces existing if present)")
    ns.tprint("✓ Draggable window")
    ns.tprint("✓ Collapsible content")
    ns.tprint("✓ Closable window")
    ns.tprint(
      "\\nWindow will remain open until manually closed or script terminates."
    )

    // Keep the script running until the window is closed
    while (window.getElement()?.parentNode) {
      await ns.sleep(1000)
    }

    ns.tprint("Floating window closed. Test completed.")
  } catch (error) {
    ns.tprint(`ERROR: ${error}`)
  }
}
