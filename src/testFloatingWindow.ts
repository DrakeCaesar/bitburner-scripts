import { NS } from "@ns"
import {
  createMinimalWindow,
  createStyleAWindow,
  createStyleBWindow,
  FloatingWindow,
} from "./floatingWindow"

export async function main(ns: NS) {
  ns.tprint("Starting Floating Window Test...")

  // Test content for all windows
  const testContent = `
    <div>
      <h3>Test Window Content</h3>
      <p>This is a demonstration of the floating window system.</p>
      <ul>
        <li>Draggable: Yes</li>
        <li>Collapsible: Yes</li>
        <li>Closable: Yes</li>
      </ul>
      <p>Current time: ${new Date().toLocaleTimeString()}</p>
    </div>
  `

  const complexContent = `
    <div style="padding: 10px;">
      <h4>Advanced Test Content</h4>
      <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
        <tr style="border-bottom: 1px solid #444;">
          <th style="text-align: left; padding: 5px;">Property</th>
          <th style="text-align: right; padding: 5px;">Value</th>
        </tr>
        <tr style="border-bottom: 1px solid #333;">
          <td style="padding: 5px;">Server Count</td>
          <td style="text-align: right; padding: 5px;">${ns.getPurchasedServers().length}</td>
        </tr>
        <tr style="border-bottom: 1px solid #333;">
          <td style="padding: 5px;">Home RAM</td>
          <td style="text-align: right; padding: 5px;">${ns.formatRam(ns.getServerMaxRam("home"))}</td>
        </tr>
        <tr style="border-bottom: 1px solid #333;">
          <td style="padding: 5px;">Hack Level</td>
          <td style="text-align: right; padding: 5px;">${ns.getHackingLevel()}</td>
        </tr>
      </table>
      <div style="margin-top: 15px;">
        <button onclick="this.style.backgroundColor='#4caf50'; this.textContent='Clicked!'" 
                style="background: #2196f3; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
          Interactive Button
        </button>
      </div>
    </div>
  `

  // Create windows with different styles
  let windows: FloatingWindow[] = []

  try {
    // Style A Window (First theme)
    const windowA = createStyleAWindow("Style A - Theme 1", testContent, 50, 50)
    windows.push(windowA)
    ns.tprint("Created Style A window")

    await ns.sleep(500)

    // Style B Window (Second theme)
    const windowB = createStyleBWindow(
      "Style B - Theme 2",
      complexContent,
      400,
      50
    )
    windows.push(windowB)
    ns.tprint("Created Style B window")

    await ns.sleep(500)

    // Style C Window (Minimal)
    const windowC = createMinimalWindow(
      "Style C - Minimal",
      `
        <div>
          <h4>Minimal Style Window</h4>
          <p>This window uses no MUI classes and has a clean, minimal design.</p>
          <p>Perfect for custom content that doesn't need to match the game UI.</p>
          <p style="color: #4caf50;">✓ Lightweight</p>
          <p style="color: #4caf50;">✓ Customizable</p>
          <p style="color: #4caf50;">✓ Performance focused</p>
        </div>
      `,
      750,
      50
    )
    windows.push(windowC)
    ns.tprint("Created Style C (minimal) window")

    await ns.sleep(500)

    // Create a data monitoring window that updates
    const monitoringWindow = new FloatingWindow({
      title: "Real-time Monitor",
      content: "<p>Loading...</p>",
      x: 50,
      y: 400,
      width: 350,
      height: 250,
      styleVariant: "A",
    })
    windows.push(monitoringWindow)

    ns.tprint("Created monitoring window")

    // Update monitoring window every 2 seconds
    let updateCount = 0
    const monitoringInterval = setInterval(() => {
      updateCount++
      const monitorContent = `
        <div style="font-family: monospace;">
          <h4>System Monitor</h4>
          <p><strong>Update #:</strong> ${updateCount}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
          <p><strong>Money:</strong> ${ns.formatNumber(ns.getServerMoneyAvailable("home"))}</p>
          <p><strong>Hack XP:</strong> ${ns.formatNumber(ns.getPlayer().exp.hacking)}</p>
          <p><strong>Scripts Running:</strong> ${ns.ps().length}</p>
          <div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px;">
            <small>Auto-updating every 2 seconds...</small>
          </div>
        </div>
      `
      monitoringWindow.updateContent(monitorContent)
    }, 2000)

    // Create a control panel window
    const controlWindow = new FloatingWindow({
      title: "Control Panel",
      content: `
        <div>
          <h4>Window Controls</h4>
          <p>Use these buttons to test window functionality:</p>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
            <button onclick="document.querySelector('[data-window-id=\\"demo-style-a\\"]')?.click()" 
                    style="padding: 8px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Toggle Style A Window
            </button>
            <button onclick="document.querySelector('[data-window-id=\\"demo-style-b\\"]')?.click()" 
                    style="padding: 8px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Toggle Style B Window
            </button>
            <button onclick="document.querySelector('[data-window-id=\\"demo-style-c\\"]')?.click()" 
                    style="padding: 8px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Toggle Style C Window
            </button>
          </div>
          <p style="margin-top: 15px; font-size: 12px; color: #aaa;">
            Click and drag window headers to move them around.<br>
            Use collapse buttons (▲/▼) to minimize/maximize.<br>
            Click ✕ to close windows.
          </p>
        </div>
      `,
      x: 400,
      y: 400,
      width: 300,
      height: 280,
      styleVariant: "C",
    })
    windows.push(controlWindow)

    // Add window IDs for control panel buttons
    windowA.getElement()?.setAttribute("data-window-id", "demo-style-a")
    windowB.getElement()?.setAttribute("data-window-id", "demo-style-b")
    windowC.getElement()?.setAttribute("data-window-id", "demo-style-c")

    ns.tprint("Created control panel window")
    ns.tprint(`\\n=== Floating Window Test Complete ===`)
    ns.tprint(`Created ${windows.length} test windows:`)
    ns.tprint(`• Style A Window (Bitburner Theme 1)`)
    ns.tprint(`• Style B Window (Bitburner Theme 2)`)
    ns.tprint(`• Style C Window (Minimal Design)`)
    ns.tprint(`• Real-time Monitor (Auto-updating)`)
    ns.tprint(`• Control Panel (Interactive)`)
    ns.tprint(`\\nTest features:`)
    ns.tprint(`✓ Draggable windows`)
    ns.tprint(`✓ Collapsible content`)
    ns.tprint(`✓ Closable windows`)
    ns.tprint(`✓ Live content updates`)
    ns.tprint(`✓ Different styling options`)
    ns.tprint(
      `\\nWindows will remain open until manually closed or script terminates.`
    )

    // Keep the script running to maintain the monitoring updates
    const startTime = Date.now()
    while (windows.some((w) => w.getElement()?.parentNode)) {
      await ns.sleep(5000)

      // Auto-close after 5 minutes for demo purposes
      if (Date.now() - startTime > 300000) {
        ns.tprint("Demo time limit reached. Closing all windows...")
        clearInterval(monitoringInterval)
        windows.forEach((w) => w.close())
        break
      }
    }

    clearInterval(monitoringInterval)
    ns.tprint("Floating window test completed.")
  } catch (error) {
    ns.tprint(`ERROR: ${error}`)
    // Clean up any created windows
    windows.forEach((w) => {
      try {
        w.close()
      } catch (e) {
        // Ignore cleanup errors
      }
    })
  }
}
