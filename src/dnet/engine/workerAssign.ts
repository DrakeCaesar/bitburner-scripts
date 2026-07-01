import { DARKWEB } from "../constants.js"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"

export function availableAuthWorkers(
  workerPool: WorkerPool,
  neighborHosts: readonly string[],
  reserved: ReadonlySet<string>,
): ManagedWorker[] {
  const out: ManagedWorker[] = []
  for (const host of neighborHosts) {
    if (reserved.has(host)) continue
    const wi = workerPool.workers.get(host)
    if (wi?.idle && wi.commandPort > 0) out.push(wi)
  }
  return out
}

export function availableSpawnParents(
  workerPool: WorkerPool,
  targetHost: string,
  reserved: ReadonlySet<string>,
  options?: { stasisLinked?: ReadonlySet<string>; allowRemoteRoot?: boolean },
): ManagedWorker[] {
  const stasisLinked = options?.stasisLinked
  const allowRemoteRoot = options?.allowRemoteRoot !== false
  const idle = workerPool
    .idleWorkers()
    .filter((w) => !reserved.has(w.host) && w.commandPort > 0)
  const adjacent = idle.filter((w) => w.neighbors.includes(targetHost))

  if (allowRemoteRoot && stasisLinked?.has(targetHost)) {
    const root = idle.find((w) => w.host === DARKWEB)
    if (root) {
      return [root, ...adjacent.filter((w) => w.host !== DARKWEB)]
    }
  }
  return adjacent
}

/** Darkweb root worker spawning onto a stasis-linked host (no adjacency required). */
export function isRemoteStasisSpawn(
  parentHost: string,
  targetHost: string,
  stasisLinked: ReadonlySet<string>,
): boolean {
  return parentHost === DARKWEB && stasisLinked.has(targetHost)
}

/** Fewest worker options first; zero-option targets sort last. */
export function sortByWorkerScarcity<T>(
  items: readonly T[],
  optionCount: (item: T) => number,
  tieKey: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const countA = optionCount(a)
    const countB = optionCount(b)
    const rankA = countA === 0 ? Number.MAX_SAFE_INTEGER : countA
    const rankB = countB === 0 ? Number.MAX_SAFE_INTEGER : countB
    if (rankA !== rankB) return rankA - rankB
    return tieKey(a).localeCompare(tieKey(b))
  })
}

/**
 * Pick a worker that blocks the fewest other targets relying on it as their only option.
 */
export function pickLeastBlockingWorker(
  currentKey: string,
  options: readonly ManagedWorker[],
  otherTargetKeys: readonly string[],
  optionsForTarget: (targetKey: string) => readonly ManagedWorker[],
): ManagedWorker | null {
  if (options.length === 0) return null
  if (options.length === 1) return options[0]!

  const soleProviderCount = (workerHost: string): number => {
    let blocked = 0
    for (const key of otherTargetKeys) {
      if (key === currentKey) continue
      const alts = optionsForTarget(key)
      if (alts.length === 1 && alts[0]!.host === workerHost) blocked++
    }
    return blocked
  }

  return [...options].sort(
    (a, b) =>
      soleProviderCount(a.host) - soleProviderCount(b.host) || a.host.localeCompare(b.host),
  )[0]!
}
