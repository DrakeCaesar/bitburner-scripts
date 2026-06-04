/** Wall-clock timing for corporation script hot paths (browser / game runtime). */
export function perfNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

export interface CorpPerfSample {
  label: string
  ms: number
  note?: string
}

export interface CorpPerfReport {
  cycle: number
  samples: CorpPerfSample[]
  loopTotalMs: number
  measuredSumMs: number
  unmeasuredMs: number
}

export interface CorpPerfHistoryRow {
  label: string
  lastMs: number
  avgMs: number
  maxMs: number
}

const HISTORY_CYCLES = 12

export class CorpPerfCollector {
  private samples: CorpPerfSample[] = []
  private loopStart = 0

  startLoop(): void {
    this.samples = []
    this.loopStart = perfNow()
  }

  add(label: string, ms: number, note?: string): void {
    this.samples.push({ label, ms, note })
  }

  measure<T>(label: string, fn: () => T, note?: string): T {
    const t0 = perfNow()
    const result = fn()
    this.add(label, perfNow() - t0, note)
    return result
  }

  async measureAsync<T>(label: string, fn: () => Promise<T>, note?: string): Promise<T> {
    const t0 = perfNow()
    const result = await fn()
    this.add(label, perfNow() - t0, note)
    return result
  }

  /** Snapshot before loop end (e.g. to build Perf tab before React render). */
  peekReport(cycle: number): CorpPerfReport {
    const loopTotalMs = perfNow() - this.loopStart
    const measuredSumMs = this.samples.reduce((sum, s) => sum + s.ms, 0)
    return {
      cycle,
      samples: [...this.samples],
      loopTotalMs,
      measuredSumMs,
      unmeasuredMs: Math.max(0, loopTotalMs - measuredSumMs),
    }
  }

  finishLoop(cycle: number): CorpPerfReport {
    return this.peekReport(cycle)
  }
}

export function pushPerfHistory(history: CorpPerfReport[], report: CorpPerfReport): void {
  history.unshift(report)
  if (history.length > HISTORY_CYCLES) {
    history.length = HISTORY_CYCLES
  }
}

/** Aggregate per-label stats across recent cycles (newest first in history). */
export function buildPerfHistoryRows(history: CorpPerfReport[]): CorpPerfHistoryRow[] {
  const byLabel = new Map<string, { sum: number; count: number; max: number; last: number }>()

  for (const report of history) {
    for (const sample of report.samples) {
      const prev = byLabel.get(sample.label)
      if (!prev) {
        byLabel.set(sample.label, { sum: sample.ms, count: 1, max: sample.ms, last: sample.ms })
        continue
      }
      prev.sum += sample.ms
      prev.count += 1
      prev.max = Math.max(prev.max, sample.ms)
    }
  }

  if (history.length > 0) {
    for (const sample of history[0].samples) {
      const row = byLabel.get(sample.label)
      if (row) row.last = sample.ms
    }
  }

  const rows: CorpPerfHistoryRow[] = []
  for (const [label, stats] of byLabel) {
    rows.push({
      label,
      lastMs: stats.last,
      avgMs: stats.sum / stats.count,
      maxMs: stats.max,
    })
  }
  rows.sort((a, b) => b.lastMs - a.lastMs)
  return rows
}

export function formatPerfMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}`
  if (ms < 100) return `${ms.toFixed(1)}`
  return `${Math.round(ms)}`
}
