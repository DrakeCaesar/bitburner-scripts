/** Minimal dnet API surface for workers (isolated from dnet/types.js). */

export interface WorkerDnetApi {
  probe(): string[]
  authenticate(
    host: string,
    password: string,
    additionalMsec?: number,
  ): Promise<{ success: boolean; code?: number; message?: string; data?: unknown }>
  heartbleed(host: string, options?: { peek?: boolean }): Promise<{ success: boolean; logs: string[] }>
  getServerDetails(host?: string): {
    hasSession: boolean
    isOnline: boolean
    isConnectedToCurrentServer: boolean
  }
  connectToSession?(host: string, password: string): { success: boolean }
  getBlockedRam?(host?: string): number
  memoryReallocation?(host?: string): Promise<{ success: boolean }>
}
