import { NS } from "@ns"
import { col, createTailLog, openTailLog, W } from "./libraries/scriptLogUiLayout.js"

const DARKWEB_ARCHIVE_DIR = "darkweb"
const CONTENT_PREVIEW_LENGTH = 140

/** Groups whose filenames contain one of these substrings go in the first table. */
const JOURNALING_FILE_KEYWORDS = ["dreams", "journal", "notes", "search_history", "the_truth", "thoughts"]

const DUPE_TABLE_COLUMNS = [
  col("Content", "left", W.notesWide),
  col("#", "right", W.diff),
  col("Copies", "left", W.notes),
]

interface ContentGroup {
  files: string[]
  preview: string
}

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

function truncateContent(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= CONTENT_PREVIEW_LENGTH) {
    return trimmed
  }
  return trimmed.slice(0, CONTENT_PREVIEW_LENGTH) + "..."
}

function isJournalingFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return JOURNALING_FILE_KEYWORDS.some((kw) => lower.includes(kw))
}

function dedupeBucket(ns: NS, bucketFiles: string[]): ContentGroup[] {
  const byContent = new Map<string, ContentGroup>()
  for (const file of bucketFiles) {
    const content = ns.read(file)
    const group = byContent.get(content)
    if (group) {
      group.files.push(file)
    } else {
      byContent.set(content, { files: [file], preview: truncateContent(content) })
    }
  }
  return [...byContent.values()]
}

function sortGroups(groups: ContentGroup[]): ContentGroup[] {
  return groups.sort(
    (a, b) => b.files.length - a.files.length || fileBaseName(a.files[0]).localeCompare(fileBaseName(b.files[0]))
  )
}

function buildRows(groups: ContentGroup[]): string[][] {
  return groups.map((group) => [
    group.preview,
    String(group.files.length),
    group.files.map(fileBaseName).join(", "),
  ])
}

function renderGroupTable(
  log: ReturnType<typeof createTailLog>,
  title: string,
  groups: ContentGroup[],
  duplicateCount: number,
  totalFiles: number
): number {
  if (groups.length === 0) {
    return 0
  }
  log.section(`${title} (${duplicateCount} dup groups, ${totalFiles} files)`)
  log.table({
    columns: DUPE_TABLE_COLUMNS,
    rows: buildRows(sortGroups(groups)),
  })
  return groups.length
}

export async function main(ns: NS): Promise<void> {
  openTailLog(ns, "Darkweb Archive Dupes")

  const files = listArchiveFiles(ns)

  if (files.length === 0) {
    await createTailLog().text(`No archive files under home/${DARKWEB_ARCHIVE_DIR}/`).render(ns)
    return
  }

  const journalingFiles: string[] = []
  const otherFiles: string[] = []
  for (const file of files) {
    (isJournalingFile(fileBaseName(file)) ? journalingFiles : otherFiles).push(file)
  }

  const journalingGroups = dedupeBucket(ns, journalingFiles)
  const otherGroups = dedupeBucket(ns, otherFiles)

  const total = files.length
  const allGroups = [...journalingGroups, ...otherGroups]
  const uniqueContents = allGroups.length
  const allDuplicateGroups = allGroups.filter((g) => g.files.length > 1)
  const duplicateGroupCount = allDuplicateGroups.length
  const filesWithDuplicateContent = allDuplicateGroups.reduce((sum, g) => sum + g.files.length, 0)
  const uniqueFiles = total - filesWithDuplicateContent

  const journalingDupGroups = journalingGroups.filter((g) => g.files.length > 1)
  const journalingTotalFiles = journalingGroups.reduce((sum, g) => sum + g.files.length, 0)
  const otherDupGroups = otherGroups.filter((g) => g.files.length > 1)
  const otherTotalFiles = otherGroups.reduce((sum, g) => sum + g.files.length, 0)

  const log = createTailLog()
  log.text(
    `home/${DARKWEB_ARCHIVE_DIR}/  |  ${total} files  |  ${uniqueContents} unique  |  ${duplicateGroupCount} dup groups  |  ${uniqueFiles} standalone  |  ${filesWithDuplicateContent} share content`
  )

  const shown = [
    renderGroupTable(log, "Journaling", journalingGroups, journalingDupGroups.length, journalingTotalFiles),
    renderGroupTable(log, "Other", otherGroups, otherDupGroups.length, otherTotalFiles),
  ]

  if (shown.every((n) => n === 0)) {
    log.text("No content groups to display.")
  }

  await log.render(ns)
}
