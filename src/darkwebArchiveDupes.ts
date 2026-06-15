import { NS } from "@ns"

const DARKWEB_ARCHIVE_DIR = "darkweb"

function listArchiveFiles(ns: NS): string[] {
  try {
    return ns
      .ls("home")
      .filter((file) => file.startsWith(`${DARKWEB_ARCHIVE_DIR}/`) && !file.endsWith(".js"))
      .sort()
  } catch {
    return []
  }
}

function fileBaseName(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash >= 0 ? path.slice(slash + 1) : path
}

export async function main(ns: NS): Promise<void> {
  const files = listArchiveFiles(ns)

  if (files.length === 0) {
    ns.tprint(`No archive files under home/${DARKWEB_ARCHIVE_DIR}/`)
    return
  }

  const byContent = new Map<string, string[]>()
  for (const file of files) {
    const content = ns.read(file)
    const group = byContent.get(content) ?? []
    group.push(file)
    byContent.set(content, group)
  }

  const total = files.length
  const uniqueContents = byContent.size
  const duplicateGroups = [...byContent.values()].filter((group) => group.length > 1)
  const duplicateGroupCount = duplicateGroups.length
  const filesWithDuplicateContent = duplicateGroups.reduce((sum, group) => sum + group.length, 0)
  const uniqueFiles = total - filesWithDuplicateContent

  ns.tprint(`Archive folder: home/${DARKWEB_ARCHIVE_DIR}/`)
  ns.tprint(`Files compared: ${total}`)
  ns.tprint(`Unique contents: ${uniqueContents}`)
  ns.tprint(`Files sharing content with another file: ${filesWithDuplicateContent}`)
  ns.tprint(`Files with unique content: ${uniqueFiles}`)
  ns.tprint(`Duplicate content groups: ${duplicateGroupCount}`)

  if (duplicateGroupCount === 0) {
    return
  }

  ns.tprint("")
  ns.tprint("Duplicate groups:")

  duplicateGroups
    .sort((a, b) => b.length - a.length || fileBaseName(a[0]).localeCompare(fileBaseName(b[0])))
    .forEach((group) => {
      ns.tprint(`  x${group.length}: ${group.map(fileBaseName).join(", ")}`)
    })
}
