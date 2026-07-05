/** Batch algorithm constants (grow/weaken margins, RAM budgets, caps). */
export interface BatchOptions {
  /** GB kept free on home when sizing batch worker RAM. */
  homeReserveGb: number
  /** Multiply required grow threads (e.g. 1.1 = 10% extra). */
  growThreadsTopUp: number
  /** Multiply security delta when sizing weaken threads (e.g. 1.01 = 1% extra reduction). */
  weakenSecurityTopUp: number
  /** Fraction of worker RAM used when estimating parallel batch count. */
  ramThreshold: number
  /** Max parallel HWGW batches (use Infinity for no cap). */
  maxParallelBatches: number
  /** Max fraction of total prep RAM used when adding parallel prep targets. */
  prepParallelRamFraction: number
  /** Milliseconds between HWGW operations within a batch. */
  batchDelay: number
}

export const DEFAULT_HOME_RESERVE_GB = 150
export const DEFAULT_GROW_THREADS_TOP_UP = 1.1
export const DEFAULT_WEAKEN_SECURITY_TOP_UP = 1.01
export const DEFAULT_RAM_THRESHOLD = 1
export const DEFAULT_MAX_PARALLEL_BATCHES = 25_000
export const DEFAULT_PREP_PARALLEL_RAM_FRACTION = 0.9
export const DEFAULT_BATCH_DELAY_MS = 5

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  homeReserveGb: DEFAULT_HOME_RESERVE_GB,
  growThreadsTopUp: DEFAULT_GROW_THREADS_TOP_UP,
  weakenSecurityTopUp: DEFAULT_WEAKEN_SECURITY_TOP_UP,
  ramThreshold: DEFAULT_RAM_THRESHOLD,
  maxParallelBatches: DEFAULT_MAX_PARALLEL_BATCHES,
  prepParallelRamFraction: DEFAULT_PREP_PARALLEL_RAM_FRACTION,
  batchDelay: DEFAULT_BATCH_DELAY_MS,
}

export function resolveBatchOptions(partial?: Partial<BatchOptions>): BatchOptions {
  return { ...DEFAULT_BATCH_OPTIONS, ...partial }
}
