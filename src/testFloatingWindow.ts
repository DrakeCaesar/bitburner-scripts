import { NS } from "@ns"
import { FloatingWindow } from "./libraries/floatingWindow.js"

export async function main(ns: NS) {
  // Remove existing floating windows if they exist
  const existingWindows = document.querySelectorAll(".floating")
  existingWindows.forEach((window) => window.remove())

  // Create a canvas element for demonstration
  const canvas = document.createElement("canvas")
  canvas.width = 350
  canvas.height = 200
  canvas.style.border = "1px solid #ccc"
  canvas.style.backgroundColor = "#000"

  // Draw something on the canvas
  const ctx = canvas.getContext("2d")
  if (ctx) {
    // Draw a simple animation frame
    ctx.fillStyle = "#00ff00"
    ctx.fillRect(10, 10, 50, 50)
    ctx.fillStyle = "#ff0000"
    ctx.beginPath()
    ctx.arc(100, 50, 25, 0, 2 * Math.PI)
    ctx.fill()
    ctx.fillStyle = "#0000ff"
    ctx.fillRect(150, 30, 30, 40)

    // Add some text
    ctx.fillStyle = "#ffffff"
    ctx.font = "16px Arial"
    ctx.fillText("Canvas Content Test", 10, 100)
    ctx.fillText("This canvas is inside a floating window!", 10, 120)
  }

  // Test 1: Create a floating window with canvas content
  new FloatingWindow({
    title: "Canvas Window",
    content: canvas,
    width: 400,
    height: 280,
    id: "floating-canvas-1",
  })

  // Test 2: Create another floating window with string content for comparison
  new FloatingWindow({
    title: "Text Window",
    content: "Text content here",
    width: 350,
    height: 150,
    id: "floating-text-1",
    x: 150,
    y: 150,
  })

  ns.tprintf("Created floating windows with canvas and text content")
}
