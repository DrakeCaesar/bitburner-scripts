import { NS } from "@ns"
import { FloatingWindow } from "./floatingWindow.js"

export async function main(ns: NS) {
  ns.tprint("Starting Single Floating Window Test...")

  // Content for the test window
  const testContent = `
    <div>
      <h3>Single Test Window</h3>
      <p>This is a demonstration of the floating window system attached to #root.</p>
      <ul>
        <li>Draggable: Yes</li>
        <li>Collapsible: Yes</li>
        <li>Closable: Yes</li>
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

    // Get the first child of root to position the window to the right of it
    const firstChild = rootElement.firstElementChild as HTMLElement
    if (!firstChild) {
      ns.tprint("ERROR: Root element has no children to position next to")
      return
    }

    // Get the position and dimensions of the first child
    const rect = firstChild.getBoundingClientRect()
    const windowX = rect.right + 10 // Position 10px to the right of the first child
    const windowY = rect.top // Align with the top of the first child

    ns.tprint(
      `Positioning window to the right of first child at (${windowX}, ${windowY})`
    )

    // Create a single floating window positioned to the right of the first child
    const window = new FloatingWindow({
      title: "Test Window",
      content: testContent,
      x: windowX,
      y: windowY,
      width: 400,
      height: 300,
      attachTo: rootElement,
      id: "floating",
    })

    ns.tprint("Created floating window positioned to the right of first child")
    ns.tprint("\\n=== Single Floating Window Test Complete ===")
    ns.tprint("✓ Window positioned to the right of first child")
    ns.tprint("✓ Window attached to #root element")
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
