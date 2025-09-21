interface Operation {
  type: "H" | "W" | "G"
  start: number
  end?: number
  batchId: number
}

class BatchVisualizer {
  private canvas: HTMLCanvasElement | null = null
  private context: CanvasRenderingContext2D | null = null
  private operations: Operation[] = []
  private isInitialized = false
  private width = 0
  private height = 0
  private margin = { top: 40, right: 20, bottom: 60, left: 80 }
  private chartWidth = 0
  private chartHeight = 0
  private timeWindow = 30000 // 30 seconds visible window
  private currentBatchId = 0

  // Color mapping for operations
  private opColors = {
    H: "#ff4444", // Red for Hack
    W: "#4444ff", // Blue for Weaken
    G: "#44ff44", // Green for Grow
  }

  constructor() {
    this.initCanvas()
  }

  private initCanvas(): void {
    if (this.isInitialized) return

    // Check if canvas already exists
    let existingCanvas = document.getElementById(
      "batch-visualizer"
    ) as HTMLCanvasElement
    if (existingCanvas) {
      this.canvas = existingCanvas
    } else {
      // Create new canvas
      this.canvas = document.createElement("canvas")
      this.canvas.id = "batch-visualizer"
      this.canvas.style.position = "fixed"
      this.canvas.style.top = "0"
      this.canvas.style.left = "0"
      this.canvas.style.zIndex = "1000"
      this.canvas.style.pointerEvents = "none"
      this.canvas.style.backgroundColor = "rgba(0, 0, 0, 0.8)"
      document.body.appendChild(this.canvas)
    }

    this.width = Math.min(window.innerWidth * 0.8, 1200)
    this.height = Math.min(window.innerHeight * 0.6, 600)
    this.canvas.width = this.width
    this.canvas.height = this.height

    this.chartWidth = this.width - this.margin.left - this.margin.right
    this.chartHeight = this.height - this.margin.top - this.margin.bottom

    this.context = this.canvas.getContext("2d")
    if (this.context) {
      this.context.font = "12px monospace"
    }

    this.isInitialized = true
  }

  public startOperation(type: "H" | "W" | "G", batchId?: number): number {
    const operationId = this.operations.length
    const operation: Operation = {
      type,
      start: Date.now(),
      batchId: batchId ?? this.currentBatchId,
    }
    this.operations.push(operation)
    return operationId
  }

  public endOperation(operationId: number): void {
    if (this.operations[operationId]) {
      this.operations[operationId].end = Date.now()
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
  ): void {
    const operation: Operation = {
      type,
      start,
      end,
      batchId: batchId ?? this.currentBatchId,
    }
    this.operations.push(operation)
    this.draw()
  }

  private draw(): void {
    if (!this.context) return

    const ctx = this.context // Create a non-null reference

    // Clear canvas
    ctx.clearRect(0, 0, this.width, this.height)

    const now = Date.now()
    const startTime = now - this.timeWindow

    // Filter operations within time window
    const visibleOps = this.operations.filter(
      (op) => op.end && op.end > startTime
    )

    if (visibleOps.length === 0) return

    // Draw background
    ctx.fillStyle = "rgba(0, 0, 0, 0.9)"
    ctx.fillRect(0, 0, this.width, this.height)

    // Draw title
    ctx.fillStyle = "#ffffff"
    ctx.font = "16px monospace"
    ctx.fillText("Bitburner Batch Operations - Real Time", 10, 25)

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

      ops.forEach((op, opIndex) => {
        if (!op.end) return

        const x1 = xScale(op.start)
        const x2 = xScale(op.end!)
        const width = Math.max(x2 - x1, 2) // Minimum width of 2px
        const y = baseY + (opIndex * batchHeight) / Math.max(ops.length, 1)
        const height = (batchHeight / Math.max(ops.length, 1)) * 0.8

        // Draw operation bar
        ctx.fillStyle = this.opColors[op.type]
        ctx.fillRect(x1, y, width, height)

        // Draw operation label if bar is wide enough
        if (width > 20) {
          ctx.fillStyle = "#000000"
          ctx.font = "8px monospace"
          ctx.fillText(op.type, x1 + 2, y + height - 2)
        }

        // Draw duration text
        const duration = op.end! - op.start
        ctx.fillStyle = "#ffffff"
        ctx.font = "8px monospace"
        ctx.fillText(`${duration}ms`, x2 + 2, y + height / 2)
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
    Object.entries(this.opColors).forEach(([type, color], index) => {
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
    if (this.context) {
      this.context.clearRect(0, 0, this.width, this.height)
    }
  }

  public hide(): void {
    if (this.canvas) {
      this.canvas.style.display = "none"
    }
  }

  public show(): void {
    if (this.canvas) {
      this.canvas.style.display = "block"
    }
  }

  public remove(): void {
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    this.isInitialized = false
  }
}

// Global instance
let visualizer: BatchVisualizer | null = null

// Export functions for easy use in batch.ts
export function initBatchVisualizer(): BatchVisualizer {
  if (!visualizer) {
    visualizer = new BatchVisualizer()
  }
  return visualizer
}

export function logBatchOperation(
  type: "H" | "W" | "G",
  start: number,
  end: number,
  batchId?: number
): void {
  if (!visualizer) {
    visualizer = new BatchVisualizer()
  }
  visualizer.logOperation(type, start, end, batchId)
}

export function startBatchOperation(
  type: "H" | "W" | "G",
  batchId?: number
): number {
  if (!visualizer) {
    visualizer = new BatchVisualizer()
  }
  return visualizer.startOperation(type, batchId)
}

export function endBatchOperation(operationId: number): void {
  if (visualizer) {
    visualizer.endOperation(operationId)
  }
}

export function nextBatch(): void {
  if (visualizer) {
    visualizer.nextBatch()
  }
}

export function clearVisualization(): void {
  if (visualizer) {
    visualizer.clear()
  }
}

export function hideVisualization(): void {
  if (visualizer) {
    visualizer.hide()
  }
}

export function showVisualization(): void {
  if (visualizer) {
    visualizer.show()
  }
}

export function removeVisualization(): void {
  if (visualizer) {
    visualizer.remove()
    visualizer = null
  }
}
