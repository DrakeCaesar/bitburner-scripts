// Lightweight stub for batch visualization logging
// Assumes the main visualizer instance already exists in the global scope

declare global {
  var batchVisualiser: {
    logActualOperation(
      type: "H" | "W" | "G",
      actualStart: number,
      actualEnd: number,
      operationId: number
    ): void
  } | undefined
}

export function logActualBatchOperation(
  type: "H" | "W" | "G",
  actualStart: number,
  actualEnd: number,
  operationId: number
): void {
  // Try to access the global visualizer instance
  if (typeof globalThis.batchVisualiser !== "undefined") {
    globalThis.batchVisualiser.logActualOperation(type, actualStart, actualEnd, operationId)
  }
  // Silently fail if visualizer doesn't exist - no console pollution
}