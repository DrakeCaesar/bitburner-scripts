import { NS } from "@ns"
import type { WorkerDnetApi } from "../worker/dnetApi.js"
import { finalizeArchiveContent } from "./archive.js"
import { flatFileName, isCacheFile, isLoreFile, isPasswordFile } from "./categorize.js"
import { parsePasswordFileContent } from "./intel.js"
import type { CacheOpenRecord } from "./types.js"

export interface LocalFileScanState {
  archivedFiles: Set<string>
}

export function createLocalFileScanState(): LocalFileScanState {
  return {
    archivedFiles: new Set(),
  }
}

export function queueArchiveContent(
  ns: NS,
  fileName: string,
  content: string,
  replyPort: number,
  lorePort: number,
  neighbors: string[],
): void {
  if (isLoreFile(flatFileName(fileName))) {
    if (lorePort > 0) {
      ns.writePort(lorePort, content)
    }
    return
  }

  if (isPasswordFile(flatFileName(fileName))) {
    const hostname = ns.getHostname()
    const { intelJson } = parsePasswordFileContent(content, hostname, neighbors, Date.now())
    ns.writePort(replyPort, intelJson)
    return
  }

  const base = flatFileName(fileName)
  const hostname = ns.getHostname()

  if (hostname === "home") {
    finalizeArchiveContent(ns, base, content)
    return
  }

  ns.writePort(replyPort, JSON.stringify({ type: "archive", file: base, content }))
}

export function reportCacheOpen(
  ns: NS,
  host: string,
  fileName: string,
  result: { message: string; karmaLoss: number },
  replyPort: number,
): void {
  const entry: CacheOpenRecord = {
    host,
    file: flatFileName(fileName),
    message: result.message,
    karmaLoss: result.karmaLoss,
    openedAt: Date.now(),
  }

  ns.writePort(replyPort, JSON.stringify({ type: "cacheOpen", ...entry }))
}

export async function openCacheFilesOnCurrentHost(
  ns: NS,
  dnet: WorkerDnetApi,
  replyPort: number,
): Promise<void> {
  const hostname = ns.getHostname()
  let files: string[]
  try {
    files = ns.ls(hostname, ".cache")
  } catch {
    return
  }

  for (const file of files) {
    if (!isCacheFile(file)) {
      continue
    }
    const cacheName = flatFileName(file)
    let result: { success: boolean; message: string; karmaLoss: number }
    try {
      result = dnet.openCache(cacheName, true)
    } catch {
      continue
    }
    if (!result.success) {
      continue
    }
    reportCacheOpen(ns, hostname, cacheName, result, replyPort)
  }
}

export async function archiveNewTextFilesOnCurrentHost(
  ns: NS,
  replyPort: number,
  lorePort: number,
  neighbors: string[],
  state: LocalFileScanState,
): Promise<void> {
  const hostname = ns.getHostname()
  let files: string[]
  try {
    files = ns.ls(hostname)
  } catch {
    return
  }

  for (const file of files) {
    const base = flatFileName(file)
    const ext = base.split(".").pop()
    switch (ext) {
      case "txt":
        if (state.archivedFiles.has(base)) continue
        if (!ns.fileExists(file)) break
        queueArchiveContent(ns, base, ns.read(file), replyPort, lorePort, neighbors)
        state.archivedFiles.add(base)
        break
      case "lit":
        if (ns.fileExists(base, "home")) break
        ns.writePort(
          replyPort,
          JSON.stringify({ type: "litCopy", file: base, sourceHost: hostname }),
        )
        break
    }
  }
}

/** Open new caches first (they may drop files), then archive new .txt and copy .lit. */
export async function scanLocalServerFiles(
  ns: NS,
  dnet: WorkerDnetApi,
  replyPort: number,
  lorePort: number,
  state: LocalFileScanState,
): Promise<void> {
  const hostname = ns.getHostname()
  try {
    if (!dnet.getServerDetails(hostname).hasSession) return
  } catch {
    return
  }

  let neighbors: string[] = []
  try {
    neighbors = dnet.probe()
  } catch {
    neighbors = []
  }

  await openCacheFilesOnCurrentHost(ns, dnet, replyPort)
  await archiveNewTextFilesOnCurrentHost(ns, replyPort, lorePort, neighbors, state)
}
