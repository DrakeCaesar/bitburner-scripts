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
  private timeWindow = 1000 * 30
  private currentBatchId = 0
  private nextOperationId = 0

  // Color mapping for operations
  private predictedColors = {
    H: "#994444", // Desaturated Red for Predicted Hack
    W: "#444499", // Desaturated Blue for Predicted Weaken
    G: "#449944", // Desaturated Green for Predicted Grow
  }

  private actualColors = {
    H: "#ff4444", // Bright Red for Actual Hack
    W: "#4444ff", // Bright Blue for Actual Weaken
    G: "#44ff44", // Bright Green for Actual Grow
  }

  constructor() {
    this.initCanvas()
  }

  private initCanvas(): void {
    if (
      this.isInitialized &&
      this.floatingWindow &&
      this.floatingWindow.getElement()
    )
      return

    // Remove any existing floating windows with the same ID
    const existingWindow = document.getElementById("batch-visualiser-window")
    if (existingWindow) {
      existingWindow.remove()
    }

    // Create canvas
    this.canvas = document.createElement("canvas")
    this.canvas.id = "batch-visualiser"

    this.width = Math.min(window.innerWidth * 0.9, 2000)
    this.height = Math.min(window.innerHeight * 0.9, 1200)
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
      width: this.width + 22,
      height: this.height,
      id: "batch-visualiser-window",
      x: 50,
      y: 50,
    })

    this.isInitialized = true
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
    const operation = this.operations.find(
      (op) => op.operationId === operationId
    )
    if (operation) {
      operation.end = Date.now()
      this.draw()
    }
  }

  public nextBatch(): void {
    this.currentBatchId++
  }

  public logOperation(
    type: "H" | "W" | "G",
    start: number,
    end: number,
    batchId?: number
  ): number {
    const operationId = this.nextOperationId++
    const operation: Operation = {
      type,
      start,
      end,
      batchId: batchId ?? this.currentBatchId,
      operationId,
    }
    this.operations.push(operation)
    this.draw()
    return operationId
  }

  public logActualOperation(
    type: "H" | "W" | "G",
    actualStart: number,
    actualEnd: number,
    operationId: number
  ): void {
    // Find the exact matching predicted operation by operationId
    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i]
      if (op.operationId === operationId && !op.actualStart) {
        op.actualStart = actualStart
        op.actualEnd = actualEnd
        this.draw()
        return
      }
    }

    // If no matching predicted operation found, log warning
    console.warn(
      `No predicted operation found for operationId ${operationId}, type ${type}`
    )
  }

  private draw(): void {
    if (!this.context) return

    const ctx = this.context // Create a non-null reference

    // Clear canvas
    ctx.clearRect(0, 0, this.width, this.height)

    const now = Date.now()
    const startTime = now - this.timeWindow

    // Filter operations within time window
    const visibleOps = this.operations.filter((op) => op.start > startTime)

    if (visibleOps.length === 0) return

    // Draw background
    ctx.fillStyle = "rgba(0, 0, 0, 0.9)"
    ctx.fillRect(0, 0, this.width, this.height)

    // Draw title
    ctx.fillStyle = "#ffffff"
    ctx.font = "16px monospace"
    // ctx.fillText("Batching", 10, 25)

    // Calculate scales
    const xScale = (time: number) =>
      this.margin.left +
      ((time - startTime) * this.chartWidth) / this.timeWindow

    const yScale = (index: number, total: number) =>
      this.margin.top + (index * this.chartHeight) / Math.max(total, 1)

    // Group operations by batch
    const batchGroups = new Map<number, Operation[]>()
    visibleOps.forEach((op) => {
      if (!batchGroups.has(op.batchId)) {
        batchGroups.set(op.batchId, [])
      }
      batchGroups.get(op.batchId)!.push(op)
    })

    // Draw grid lines
    ctx.strokeStyle = "#333333"
    ctx.lineWidth = 1
    ctx.beginPath()

    // Vertical grid lines (time)
    for (let i = 0; i <= 10; i++) {
      const x = this.margin.left + (i * this.chartWidth) / 10
      ctx.moveTo(x, this.margin.top)
      ctx.lineTo(x, this.margin.top + this.chartHeight)
    }

    // Horizontal grid lines (batches)
    const totalBatches = Math.max(batchGroups.size, 1)
    for (let i = 0; i <= totalBatches; i++) {
      const y = yScale(i, totalBatches)
      ctx.moveTo(this.margin.left, y)
      ctx.lineTo(this.margin.left + this.chartWidth, y)
    }
    ctx.stroke()

    // Draw axes
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(this.margin.left, this.margin.top)
    ctx.lineTo(this.margin.left, this.margin.top + this.chartHeight)
    ctx.moveTo(this.margin.left, this.margin.top + this.chartHeight)
    ctx.lineTo(
      this.margin.left + this.chartWidth,
      this.margin.top + this.chartHeight
    )
    ctx.stroke()

    // Draw operations
    let batchIndex = 0
    for (const [batchId, ops] of batchGroups.entries()) {
      const baseY = yScale(batchIndex, batchGroups.size)
      const batchHeight =
        (this.chartHeight / Math.max(batchGroups.size, 1)) * 0.8

      // Draw batch label
      ctx.fillStyle = "#ffffff"
      ctx.font = "10px monospace"
      ctx.fillText(`Batch ${batchId}`, 5, baseY + batchHeight / 2)

      // Sort operations by start time
      ops.sort((a, b) => a.start - b.start)

      ops.forEach((op) => {
        if (!op.end) return

        // Use a fixed slot system - always assume 4 operations per batch for consistent spacing
        const maxOpsPerBatch = 4
        const slotIndex = op.operationId % maxOpsPerBatch
        const y = baseY + (slotIndex * batchHeight) / maxOpsPerBatch
        const opHeight = (batchHeight / maxOpsPerBatch) * 1
        const barHeight = opHeight / 2 // Split height for two bars

        // Draw predicted operation bar (top half)
        const x1 = xScale(op.start)
        const x2 = xScale(op.end!)
        const width = Math.max(x2 - x1, 2) // Minimum width of 2px

        // Use desaturated color for predicted bars
        ctx.fillStyle = this.predictedColors[op.type]
        ctx.fillRect(x1, y, width, barHeight)

        // Draw operation label if bar is wide enough
        if (width > 20) {
          ctx.fillStyle = "#000000"
          ctx.font = "8px monospace"
          ctx.fillText(op.type, x1 + 2, y + barHeight - 2)
        }

        // Draw predicted duration text
        const duration = Math.round(op.end! - op.start)
        ctx.fillStyle = "#ffffff"
        ctx.font = "8px monospace"
        ctx.fillText(`P:${duration}ms`, x2 + 2, y + barHeight / 2)

        // Draw actual operation bar (bottom half) if available
        if (op.actualStart && op.actualEnd) {
          const actualX1 = xScale(op.actualStart)
          const actualX2 = xScale(op.actualEnd)
          const actualWidth = Math.max(actualX2 - actualX1, 2)
          const actualY = y + barHeight

          // Use full saturated color for actual bars
          ctx.fillStyle = this.actualColors[op.type]
          ctx.fillRect(actualX1, actualY, actualWidth, barHeight)

          // Draw actual duration text
          const actualDuration = Math.round(op.actualEnd - op.actualStart)
          ctx.fillStyle = "#cccccc"
          ctx.font = "8px monospace"
          ctx.fillText(
            `A:${actualDuration}ms`,
            actualX2 + 2,
            actualY + barHeight / 2
          )
        }
      })

      batchIndex++
    }

    // Draw time axis labels
    ctx.fillStyle = "#ffffff"
    ctx.font = "10px monospace"
    for (let i = 0; i <= 5; i++) {
      const x = this.margin.left + (i * this.chartWidth) / 5
      const timeAgo = ((5 - i) * (this.timeWindow / 5)) / 1000
      ctx.fillText(`-${timeAgo.toFixed(1)}s`, x - 15, this.height - 10)
    }

    // Draw legend
    const legendY = this.margin.top + this.chartHeight + 20
    Object.entries(this.actualColors).forEach(([type, color], index) => {
      const x = this.margin.left + index * 80
      ctx.fillStyle = color
      ctx.fillRect(x, legendY, 15, 15)
      ctx.fillStyle = "#ffffff"
      ctx.fillText(
        type === "H" ? "Hack" : type === "W" ? "Weaken" : "Grow",
        x + 20,
        legendY + 12
      )
    })

    // Draw current operations count
    ctx.fillStyle = "#ffffff"
    ctx.font = "12px monospace"
    ctx.fillText(
      `Operations: ${this.operations.length} | Batches: ${this.currentBatchId + 1}`,
      this.width - 200,
      25
    )
  }

  public clear(): void {
    this.operations = []
    this.currentBatchId = 0
    this.nextOperationId = 0
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
export function initBatchVisualiser(): BatchVisualiser {
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

export function logBatchOperation(
  type: "H" | "W" | "G",
  start: number,
  end: number,
  batchId?: number
): number {
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
  visualiser.logActualOperation(type, actualStart, actualEnd, operationId)
}

export function startBatchOperation(
  type: "H" | "W" | "G",
  batchId?: number
): number {
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

export function nextBatch(): void {
  if (visualiser) {
    visualiser.nextBatch()
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
