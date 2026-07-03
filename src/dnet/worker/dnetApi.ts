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
  heartbleed(
    host: string,
    options?: { peek?: boolean },
  ): Promise<{ success: boolean; logs: string[]; message?: string; code?: number }>
  getServerDetails(host?: string): WorkerServerDetails
  /** Darknet depth of host (defaults to current server). Returns -1 when unknown. */
  getDepth?(host?: string): number
  connectToSession?(host: string, password: string): { success: boolean }
  getStasisLinkedServers?(returnByIP?: boolean): string[]
  getBlockedRam?(host?: string): number
  /** Induce migration on a directly connected neighbor (not self). ~6s. */
  induceServerMigration?(host: string): Promise<{ success: boolean; code?: number; message?: string }>
  memoryReallocation?(host?: string): Promise<{ success: boolean }>
  openCache(filename: string, suppressToast?: boolean): { success: boolean; message: string; karmaLoss: number }
  labreport?(): Promise<{
    success: boolean
    coords: number[]
    north: boolean
    east: boolean
    south: boolean
    west: boolean
    message?: string
  }>
}
