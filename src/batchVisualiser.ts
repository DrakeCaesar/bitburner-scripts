import { FloatingWindow } from "./libraries/floatingWindow.js"

interface Operation {
  type: "H" | "W" | "G"
  start: number
  end?: number
  batchId: number
  operationId: number
  actualStart?: number
  actualEnd?: number
}

class BatchVisualiser {
  private canvas: HTMLCanvasElement | null = null
  private context: CanvasRenderingContext2D | null = null
  private floatingWindow: FloatingWindow | null = null
  private operations: Operation[] = []
  private isInitialized = false
  private width = 0
  private height = 0
  private margin = { top: 40, right: 20, bottom: 60, left: 80 }
  private chartWidth = 0
  private chartHeight = 0
  private currentBatchId = 0
  private nextOperationId = 0
  private animationId: number | null = null
  private isAnimating = false
  private lastBatchTime = 0
  private firstBatchTime = 0 // When the first batch was created

  // Color mapping for operations
  private predictedColors = {
    H: "#664444", // Desaturated Red for Predicted Hack
    W: "#444466", // Desaturated Blue for Predicted Weaken
    G: "#446644", // Desaturated Green for Predicted Grow
  }

  private actualColors = {
    H: "#884444", // Bright Red for Actual Hack
    W: "#444488", // Bright Blue for Actual Weaken
    G: "#448844", // Bright Green for Actual Grow
  }

  constructor() {
    this.initCanvas()
    this.startAnimation()
  }

  private initCanvas(): void {
    if (this.isInitialized && this.floatingWindow && this.floatingWindow.getElement()) return

    // Remove any existing floating windows with the same ID
    const existingWindow = document.getElementById("batch-visualiser-window")
    if (existingWindow) {
      existingWindow.remove()
    }

    // Create canvas
    this.canvas = document.createElement("canvas")
    this.canvas.id = "batch-visualiser"

    this.width = Math.min(window.innerWidth * 0.9, 2000)
    this.height = Math.min(window.innerHeight * 0.9, 900)
    this.canvas.width = this.width
    this.canvas.height = this.height
    this.canvas.style.backgroundColor = "rgba(0, 0, 0, 0.9)"
    this.canvas.style.border = "1px solid #333"
    this.canvas.style.borderRadius = "4px"

    this.chartWidth = this.width - this.margin.left - this.margin.right
    this.chartHeight = this.height - this.margin.top - this.margin.bottom

    this.context = this.canvas.getContext("2d")
    if (this.context) {
      this.context.font = "12px monospace"
    }

    // Create floating window with canvas
    this.floatingWindow = new FloatingWindow({
      title: "Batching",
      content: this.canvas,
      width: this.width + 18,
      height: this.height,
      id: "batch-visualiser-window",
      x: 50,
      y: 50,
    })

    this.isInitialized = true
  }

  private startAnimation(): void {
    if (this.isAnimating) return
    this.isAnimating = true
    this.animate()
  }

  private stopAnimation(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    this.isAnimating = false
  }

  private animate(): void {
    if (!this.isAnimating) return

    this.draw()
    this.animationId = requestAnimationFrame(() => this.animate())
  }

  public startOperation(type: "H" | "W" | "G", batchId?: number): number {
    const operationId = this.nextOperationId++
    const operation: Operation = {
      type,
      start: Date.now(),
      batchId: batchId ?? this.currentBatchId,
      operationId,
    }
    this.operations.push(operation)
    return operationId
  }

  public endOperation(operationId: number): void {
    const operation = this.operations.find((op) => op.operationId === operationId)
    if (operation) {
      operation.end = Date.now()
    }
  }

  public logOperation(type: "H" | "W" | "G", start: number, end: number, batchId?: number): number {
    const operationId = this.nextOperationId++
    const operation: Operation = {
      type,
      start,
      end,
      batchId: batchId ?? this.currentBatchId,
      operationId,
    }
    this.operations.push(operation)
    return operationId
  }

  public logActualOp(type: "H" | "W" | "G", actualStart: number, actualEnd: number, operationId: number): void {
    // Find the exact matching predicted operation by operationId
    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i]
      if (op.operationId === operationId && !op.actualStart) {
        op.actualStart = actualStart
        op.actualEnd = actualEnd
        return
      }
    }

    // If no matching predicted operation found, log warning
    console.warn(`No predicted operation found for operationId ${operationId}, type ${type}`)
  }

  private draw(): void {
    if (!this.context) return

    const ctx = this.context

    // Clear canvas
    ctx.clearRect(0, 0, this.width, this.height)

    // Draw background
    ctx.fillStyle = "rgba(0, 0, 0, 0.9)"
    ctx.fillRect(0, 0, this.width, this.height)

    if (this.operations.length === 0) return

    // Group operations by batch
    const batchGroups = new Map<number, Operation[]>()
    this.operations.forEach((op) => {
      if (!batchGroups.has(op.batchId)) {
        batchGroups.set(op.batchId, [])
      }
      batchGroups.get(op.batchId)!.push(op)
    })

    // Calculate row height (each batch = 4 operations stacked vertically)
    const operationHeight = 20
    const batchHeight = operationHeight * 4
    const batchSpacing = 5

    // Auto-scroll to keep newest batches visible
    const totalBatches = batchGroups.size
    const maxVisibleBatches = Math.floor(this.chartHeight / (batchHeight + batchSpacing))
    let scrollOffset = 0
    if (totalBatches > maxVisibleBatches) {
      scrollOffset = (totalBatches - maxVisibleBatches) * (batchHeight + batchSpacing)
    }

    // Draw header
    ctx.fillStyle = "#ffffff"
    ctx.font = "14px monospace"
    ctx.fillText(`Batches: ${totalBatches} | Operations: ${this.operations.length}`, 10, 25)

    // Draw legend
    const legendY = 25
    Object.entries(this.actualColors).forEach(([type, color], index) => {
      const x = this.width - 220 + index * 70
      ctx.fillStyle = color
      ctx.fillRect(x, legendY - 10, 12, 12)
      ctx.fillStyle = "#ffffff"
      ctx.font = "10px monospace"
      ctx.fillText(type, x + 16, legendY)
    })

    // Sort batches by ID
    const sortedBatchIds = Array.from(batchGroups.keys()).sort((a, b) => a - b)

    // Draw each batch
    for (const batchId of sortedBatchIds) {
      const ops = batchGroups.get(batchId)!
      const batchY = this.margin.top + batchId * (batchHeight + batchSpacing) - scrollOffset

      // Skip if outside visible area
      if (batchY + batchHeight < this.margin.top || batchY > this.height - this.margin.bottom) {
        continue
      }

      // Draw batch number
      ctx.fillStyle = "#aaaaaa"
      ctx.font = "10px monospace"
      ctx.fillText(`#${batchId}`, 10, batchY + batchHeight / 2)

      // Draw each operation vertically stacked (already in correct order: H, W1, G, W2)
      ops.forEach((op, opIndex) => {
        if (!op.end) return

        const opY = batchY + opIndex * operationHeight
        const barX = this.margin.left
        const barHeight = operationHeight - 2

        // Use a fixed time scale for all bars (e.g., 1 pixel per 100ms)
        const msPerPixel = 100
        const maxBarWidth = this.chartWidth - 50

        // Calculate bar widths based on absolute duration
        const predictedDuration = op.end! - op.start
        const predictedBarWidth = Math.min((predictedDuration / msPerPixel), maxBarWidth)

        // Draw predicted bar (width = duration)
        ctx.fillStyle = this.predictedColors[op.type]
        ctx.fillRect(barX, opY, predictedBarWidth, barHeight)

        // Draw actual bar on top if available
        if (op.actualStart && op.actualEnd) {
          const actualDuration = op.actualEnd - op.actualStart
          const actualBarWidth = Math.min((actualDuration / msPerPixel), maxBarWidth)

          ctx.fillStyle = this.actualColors[op.type]
          ctx.globalAlpha = 0.7
          ctx.fillRect(barX, opY, actualBarWidth, barHeight)
          ctx.globalAlpha = 1.0
        }

        // Draw operation label
        ctx.fillStyle = "#ffffff"
        ctx.font = "12px monospace"
        ctx.fillText(op.type, barX + 5, opY + barHeight / 2 + 4)

        // Draw durations
        const predictedDurationMs = Math.round(predictedDuration)
        ctx.fillStyle = "#ffffff"
        ctx.font = "10px monospace"
        ctx.fillText(`P:${predictedDurationMs}ms`, barX + 30, opY + barHeight / 2 + 3)

        if (op.actualEnd) {
          const actualDurationMs = Math.round(op.actualEnd - op.actualStart!)
          ctx.fillStyle = "#ffff00"
          ctx.fillText(`A:${actualDurationMs}ms`, barX + Math.max(predictedBarWidth + 5, 130), opY + barHeight / 2 + 3)
        }
      })
    }
  }

  public clear(): void {
    this.operations = []
    this.currentBatchId = 0
    this.nextOperationId = 0
    this.lastBatchTime = 0
    this.firstBatchTime = 0
    if (this.context) {
      this.context.clearRect(0, 0, this.width, this.height)
    }
  }

  public hide(): void {
    if (this.floatingWindow) {
      this.floatingWindow.hide()
    }
  }

  public show(): void {
    if (this.floatingWindow) {
      this.floatingWindow.show()
    }
  }

  public remove(): void {
    this.stopAnimation()
    if (this.floatingWindow) {
      this.floatingWindow.close()
      this.floatingWindow = null
    }
    this.canvas = null
    this.context = null
    this.isInitialized = false
  }

  public getElement(): HTMLElement | null {
    return this.floatingWindow?.getElement() || null
  }
}

// Global instance
let visualiser: BatchVisualiser | null = null

// Export functions for easy use in batch.ts
export function initBatchVisualiser(batchInterval?: number): BatchVisualiser {
  // Remove any existing visualiser instances
  if (visualiser) {
    visualiser.remove()
  }

  // Kill any existing floating windows with the same ID
  const existingWindow = document.getElementById("batch-visualiser-window")
  if (existingWindow) {
    existingWindow.remove()
  }

  visualiser = new BatchVisualiser()

  // Expose visualizer globally for lightweight stub access
  ;(globalThis as any).batchVisualiser = visualiser

  return visualiser
}

export function logBatchOperation(type: "H" | "W" | "G", start: number, end: number, batchId?: number): number {
  if (!visualiser) {
    visualiser = new BatchVisualiser()
  }
  return visualiser.logOperation(type, start, end, batchId)
}

export function logActualBatchOperation(
  type: "H" | "W" | "G",
  actualStart: number,
  actualEnd: number,
  operationId: number
): void {
  if (!visualiser) {
    visualiser = new BatchVisualiser()
  }
  visualiser.logActualOp(type, actualStart, actualEnd, operationId)
}

export function startBatchOperation(type: "H" | "W" | "G", batchId?: number): number {
  if (!visualiser) {
    visualiser = new BatchVisualiser()
  }
  return visualiser.startOperation(type, batchId)
}

export function endBatchOperation(operationId: number): void {
  if (visualiser) {
    visualiser.endOperation(operationId)
  }
}

export function clearVisualization(): void {
  if (visualiser) {
    visualiser.clear()
  }
}

export function hideVisualization(): void {
  if (visualiser) {
    visualiser.hide()
  }
}

export function showVisualization(): void {
  if (visualiser) {
    visualiser.show()
  }
}

export function removeVisualization(): void {
  if (visualiser) {
    visualiser.remove()
    visualiser = null
  }
}
