export async function main(): Promise<void> {
  const doc: Document = document

  // Create a new div element to hold the scanlines
  const scanlines = doc.createElement("div")
  scanlines.style.position = "fixed"
  scanlines.style.top = "0"
  scanlines.style.left = "0"
  scanlines.style.width = "100%"
  scanlines.style.height = "100%"
  scanlines.style.pointerEvents = "none"
  scanlines.style.background = `repeating-linear-gradient(to bottom, transparent, transparent 2px, rgba(255, 255, 255, 0.2) 2px, rgba(255, 255, 255, 0.2) 3px)`
  scanlines.style.zIndex = "9999" // Set a high z-index value

  // Append the scanlines element to the document body
  doc.body.appendChild(scanlines)
}
