import type { DnetApi, ServerDetails, StasisSnapshot } from "../types.js"

export function getServerDetails(dnet: DnetApi, host: string): ServerDetails | null {
  try {
    return dnet.getServerDetails(host)
  } catch {
    return null
  }
}

export function isReachableNeighbor(dnet: DnetApi, target: string): boolean {
  const details = getServerDetails(dnet, target)
  return details?.isConnectedToCurrentServer === true
}

export function tryConnect(dnet: DnetApi, host: string, password: string): boolean {
  if (!dnet.connectToSession || getServerDetails(dnet, host) == null) return false
  try {
    return dnet.connectToSession(host, password).success
  } catch {
    return false
  }
}

export function readStasisSnapshot(dnet: DnetApi): StasisSnapshot | null {
  if (!dnet.getStasisLinkLimit || !dnet.getStasisLinkedServers) return null
  try {
    const limit = dnet.getStasisLinkLimit()
    const linkedHosts = [...dnet.getStasisLinkedServers()].sort((a, b) => a.localeCompare(b))
    const used = linkedHosts.length
    return {
      limit,
      used,
      available: Math.max(0, limit - used),
      linkedHosts,
    }
  } catch {
    return null
  }
}
