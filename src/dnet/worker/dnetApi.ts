/** Minimal dnet API surface for workers (isolated from dnet/types.js). */

import type { FormulasServerDetails } from "./taskTiming.js"

export type WorkerServerDetails = FormulasServerDetails & {
  isOnline: boolean
}

export interface WorkerDnetApi {
  probe(): string[]
  authenticate(
    host: string,
    password: string,
    additionalMsec?: number,
  ): Promise<{ success: boolean; code?: number; message?: string; data?: unknown }>
  heartbleed(host: string, options?: { peek?: boolean }): Promise<{ success: boolean; logs: string[] }>
  getServerDetails(host?: string): WorkerServerDetails
  connectToSession?(host: string, password: string): { success: boolean }
  getBlockedRam?(host?: string): number
  memoryReallocation?(host?: string): Promise<{ success: boolean }>
}
