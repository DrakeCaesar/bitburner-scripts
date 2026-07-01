import { NS } from "@ns"
import { DARKNET_LORE_FILE, DARKWEB_ARCHIVE_DIR, flatFileName } from "./categorize.js"

export interface DarknetLoreStore {
  journal: Set<string>
  literature: Set<string>
}

function readStringSet(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((item): item is string => typeof item === "string"))
}

export function loadDarknetLoreStore(ns: NS, file: string = DARKNET_LORE_FILE): DarknetLoreStore {
  if (!ns.fileExists(file, "home")) {
    return { journal: new Set(), literature: new Set() }
  }
  try {
    const parsed: unknown = JSON.parse(ns.read(file))
    if (Array.isArray(parsed)) {
      return { journal: readStringSet(parsed), literature: new Set() }
    }
    if (typeof parsed === "object" && parsed !== null) {
      const row = parsed as Record<string, unknown>
      return {
        journal: readStringSet(row.journal),
        literature: readStringSet(row.literature),
      }
    }
  } catch {
    /* ignore */
  }
  return { journal: new Set(), literature: new Set() }
}

export function syncDarknetLoreFile(
  ns: NS,
  store: DarknetLoreStore,
  file: string = DARKNET_LORE_FILE,
): void {
  ns.write(
    file,
    JSON.stringify(
      {
        journal: [...store.journal].sort(),
        literature: [...store.literature].sort(),
      },
      null,
      2,
    ),
    "w",
  )
}

/** @deprecated use loadDarknetLoreStore */
export function loadDarknetTextSet(ns: NS, file: string = DARKNET_LORE_FILE): Set<string> {
  return loadDarknetLoreStore(ns, file).journal
}

/** @deprecated use syncDarknetLoreFile */
export function syncDarknetTextFile(ns: NS, textSet: Set<string>, file: string = DARKNET_LORE_FILE): void {
  syncDarknetLoreFile(ns, { journal: textSet, literature: new Set() }, file)
}

function archiveDestPath(fileName: string, suffix: number | null): string {
  const base = flatFileName(fileName)
  if (suffix === null) {
    return `${DARKWEB_ARCHIVE_DIR}/${base}`
  }
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return `${DARKWEB_ARCHIVE_DIR}/${base}.${suffix}`
  }
  const stem = base.slice(0, dot)
  const ext = base.slice(dot)
  return `${DARKWEB_ARCHIVE_DIR}/${stem}.${suffix}${ext}`
}

function listArchivePaths(ns: NS, fileName: string): string[] {
  const paths: string[] = []
  const basePath = archiveDestPath(fileName, null)
  if (ns.fileExists(basePath, "home")) {
    paths.push(basePath)
  }
  let suffix = 1
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      break
    }
    paths.push(path)
    suffix++
  }
  return paths
}

function resolveArchiveWritePath(ns: NS, fileName: string, content: string): string | null {
  for (const path of listArchivePaths(ns, fileName)) {
    if (ns.read(path) === content) {
      return null
    }
  }
  let suffix: number | null = null
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      return path
    }
    suffix = suffix === null ? 1 : suffix + 1
  }
}

export function finalizeArchiveContent(ns: NS, fileName: string, content: string): void {
  const destPath = resolveArchiveWritePath(ns, fileName, content)
  if (destPath === null) {
    return
  }
  ns.write(destPath, content, "w")
}

export function copyLiteratureFromHost(ns: NS, fileName: string, sourceHost: string): boolean {
  const base = flatFileName(fileName)
  if (ns.fileExists(base, "home")) return true
  return ns.scp(base, "home", sourceHost)
}
