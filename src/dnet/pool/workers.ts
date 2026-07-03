import { PORT_POOL_START, PORT_POOL_SIZE } from "../constants.js"

export class PortPool {
  private free: number[]

  constructor() {
    this.free = []
    for (let i = 0; i < PORT_POOL_SIZE; i += 2) {
      this.free.push(PORT_POOL_START + i)
    }
  }

  allocate(): number {
    return this.free.pop() ?? 0
  }

  release(port: number): void {
    if (port >= PORT_POOL_START) this.free.push(port)
  }
}

export interface ManagedWorker {
  host: string
  pid: number
  commandPort: number
  replyPort: number
  idle: boolean
  neighbors: string[]
  lastCommand: string | null
  lastReply: string | null
  lastActivityAt: number
  /** Latest command deadline (worker-reported or master fallback). 0 when idle. */
  commandDeadlineAt: number
  /** Mutation generation this worker last probed for (-1 = not synced). */
  probeSyncMutation: number
  /** Last known darknet depth from probe (null if not yet probed). */
  depth: number | null
  freeRam: number
  blockedRam: number
}

export class WorkerPool {
  readonly workers = new Map<string, ManagedWorker>()

  register(host: string, pid: number, commandPort: number): ManagedWorker {
    const wi: ManagedWorker = {
      host,
      pid,
      commandPort,
      replyPort: commandPort + 1,
      idle: true,
      neighbors: [],
      lastCommand: null,
      lastReply: null,
      lastActivityAt: Date.now(),
      commandDeadlineAt: 0,
      probeSyncMutation: -1,
      depth: null,
      freeRam: 0,
      blockedRam: 0,
    }
    this.workers.set(host, wi)
    return wi
  }

  remove(host: string): ManagedWorker | undefined {
    const wi = this.workers.get(host)
    if (wi) this.workers.delete(host)
    return wi
  }

  idleWorkers(): ManagedWorker[] {
    return [...this.workers.values()].filter((w) => w.idle && w.commandPort > 0)
  }

  neighborForTarget(targetHost: string, neighborHosts: string[]): ManagedWorker | null {
    for (const host of neighborHosts) {
      const wi = this.workers.get(host)
      if (wi && wi.idle && wi.commandPort > 0) return wi
    }
    return null
  }
}
