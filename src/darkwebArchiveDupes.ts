import { NS } from "@ns"
import { col, createTailLog, openTailLog, W } from "./libraries/scriptLogUiLayout.js"

const DARKWEB_ARCHIVE_DIR = "darkweb"
const CONTENT_PREVIEW_LENGTH = 140

/** Separate from darknet-registry.json — deduplicated journaling/social hint content. */
export const DARKNET_TEXT_FILE = "darknet-text.json"

/** Groups whose filenames contain one of these substrings go in the first table. */
const JOURNALING_FILE_KEYWORDS = ["dreams", "journal", "notes", "search_history", "the_truth", "thoughts"]

const DUPE_TABLE_COLUMNS = [
  col("Content", "left", W.notesWide),
  col("#", "right", W.diff),
  col("Copies", "left", W.notes),
]

const PASSWORD_PREFIX = "Some common passwords include "
const PASSWORD_PREFIX_NO_SPACE = "Some common passwords include"
const PASSWORD_LIST_COLUMNS = [
  col("List", "left", W.notesWide),
  col("Len", "right", W.diff),
  col("Ovr", "right", W.ok),
  col("Cov", "right", W.ok),
  col("Sources", "left", W.notes),
]

interface ContentGroup {
  files: string[]
  preview: string
  fullContent: string
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
      byContent.set(content, {
        files: [file],
        preview: truncateContent(content),
        fullContent: content,
      })
    }
  }
  return [...byContent.values()]
}

function sortGroups(groups: ContentGroup[]): ContentGroup[] {
  return groups.sort((a, b) => a.preview.localeCompare(b.preview))
}

// --- host password vs hint reconciliation ---

const HOST_PASSWORD_RE = /^Server:\s+(.+?)\s+Password:\s*"(\S+?)"/gm
const HOST_HINT_RE = /^The password for (.+?) contains (\d+)\s+and\s+(\d+)/gm

interface HostPasswordEntry {
  password: string
  files: string[]
}

interface HostHintEntry {
  digits: string[]
  files: string[]
}

interface HostReconciliationRow {
  hostname: string
  password: string
  passwordDigits: string
  expectedDigits: string
  match: string
  files: string
}

const HOST_CHECK_COLUMNS = [
  col("Host", "left", W.host),
  col("Password", "left", W.num),
  col("In PW", "left", W.ok),
  col("Hints", "left", W.ok),
  col("OK?", "left", W.ok),
  col("Sources", "left", W.notes),
]

function extractHostPasswords(groups: ContentGroup[]): Map<string, HostPasswordEntry> {
  const map = new Map<string, HostPasswordEntry>()
  for (const group of groups) {
    HOST_PASSWORD_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HOST_PASSWORD_RE.exec(group.fullContent)) !== null) {
      const hostname = match[1]!.trim()
      const password = match[2]!
      map.set(hostname, { password, files: group.files.slice().sort() })
    }
  }
  return map
}

function extractHostHints(groups: ContentGroup[]): Map<string, HostHintEntry> {
  const map = new Map<string, HostHintEntry>()
  for (const group of groups) {
    HOST_HINT_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HOST_HINT_RE.exec(group.fullContent)) !== null) {
      const hostname = match[1]!.trim()
      const digit1 = match[2]!
      const digit2 = match[3]!
      const existing = map.get(hostname)
      if (existing) {
        const allDigits = [...new Set([...existing.digits, digit1, digit2])].sort()
        const allFiles = [...new Set([...existing.files, ...group.files])].sort()
        map.set(hostname, { digits: allDigits, files: allFiles })
      } else {
        map.set(hostname, {
          digits: [digit1, digit2].sort(),
          files: group.files.slice().sort(),
        })
      }
    }
  }
  return map
}

function renderHostCheckSection(
  log: ReturnType<typeof createTailLog>,
  groups: ContentGroup[]
): void {
  const passwords = extractHostPasswords(groups)
  const hints = extractHostHints(groups)

  const rows: HostReconciliationRow[] = []
  for (const [hostname, pw] of passwords) {
    const hint = hints.get(hostname)
    if (!hint) continue
    const pwDigits = [...new Set(pw.password.replace(/\D/g, "").split(""))].sort()
    const missing = hint.digits.filter((d) => !pwDigits.includes(d))
    const extra = pwDigits.filter((d) => !hint.digits.includes(d))
    let match = "OK"
    if (missing.length > 0 && extra.length > 0) match = "MISMATCH"
    else if (missing.length > 0) match = "STALE?"
    else if (extra.length > 0) match = "EXTRA"
    rows.push({
      hostname,
      password: pw.password,
      passwordDigits: pwDigits.join(""),
      expectedDigits: hint.digits.join(""),
      match,
      files: [...new Set([...pw.files, ...hint.files])].sort().map(fileBaseName).join(", "),
    })
  }

  if (rows.length === 0) return

  rows.sort((a, b) => a.hostname.localeCompare(b.hostname))

  log.section(`Host Password vs Hint Check (${rows.length} host(s))`)
  log.table({
    columns: HOST_CHECK_COLUMNS,
    rows: rows.map((r) => [r.hostname, r.password, r.passwordDigits, r.expectedDigits, r.match, r.files]),
  })
}

interface PasswordListSource {
  words: string[]
  files: string[]
}

function extractPasswordLists(groups: ContentGroup[]): PasswordListSource[] {
  const sources: PasswordListSource[] = []
  for (const group of groups) {
    const trimmed = group.fullContent.trim()
    if (!trimmed.startsWith(PASSWORD_PREFIX_NO_SPACE)) continue

    // strip the prefix (with or without a trailing newline/space)
    let tail = trimmed.slice(PASSWORD_PREFIX_NO_SPACE.length)
    tail = tail.replace(/^[:\s]+/, "").trim()
    if (!tail) continue

    // split on commas, spaces, or both; drop empty tokens
    const words = tail
      .split(/[,\s]+/)
      .map((w) => w.trim())
      .filter(Boolean)

    if (words.length === 0) continue

    sources.push({ words, files: group.files.slice().sort() })
  }
  return sources
}

/** Check whether `needle` appears as a contiguous subsequence inside `haystack`. */
function isContiguousSubsequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return true
  if (needle.length > haystack.length) return false
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/** Longest contiguous match between two word lists. Returns { startA, startB, length }. */
function findLongestCommonRun(
  a: string[],
  b: string[],
  minOverlap: number
): { startA: number; startB: number; length: number } | null {
  let best = null
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
        k++
      }
      if (k >= minOverlap && (!best || k > best.length)) {
        best = { startA: i, startB: j, length: k }
      }
    }
  }
  return best
}

/** Merge two word lists at their best overlapping run (any position, not just ends).
 *  Tries all orderings of prefix/suffix regions, ensuring both source lists remain contiguous subsequences. */
function tryMergeLists(a: PasswordListSource, b: PasswordListSource, minOverlap: number): PasswordListSource | null {
  const run = findLongestCommonRun(a.words, b.words, minOverlap)
  if (!run) return null

  const { startA, startB, length: len } = run
  const endA = startA + len - 1
  const endB = startB + len - 1

  const prefixA = a.words.slice(0, startA)
  const suffixA = a.words.slice(endA + 1)
  const prefixB = b.words.slice(0, startB)
  const suffixB = b.words.slice(endB + 1)
  const runWords = a.words.slice(startA, endA + 1)

  // Try all 4 combinations (2 prefix orders * 2 suffix orders)
  const candidates: string[][] = []

  // prefer A-prefix before B-prefix when possible (A is the "current" accumulated list)
  const prefixOrders = [
    [...prefixA, ...prefixB],
    [...prefixB, ...prefixA],
  ]
  const suffixOrders = [
    [...suffixA, ...suffixB],
    [...suffixB, ...suffixA],
  ]
  for (const pfx of prefixOrders) {
    for (const sfx of suffixOrders) {
      candidates.push([...pfx, ...runWords, ...sfx])
    }
  }

  // Deduplicate candidates
  const seen = new Set<string>()
  const unique: string[][] = []
  for (const c of candidates) {
    const key = c.join("\x00")
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(c)
    }
  }

  // Pick the first candidate that contains both source lists as contiguous subsequences
  for (const c of unique) {
    if (isContiguousSubsequence(c, a.words) && isContiguousSubsequence(c, b.words)) {
      return { words: c, files: [...new Set([...a.files, ...b.files])].sort() }
    }
  }

  // Fallback: pick longest candidate
  const best = unique.reduce((best, c) => (c.length >= best.length ? c : best), unique[0]!)
  return { words: best, files: [...new Set([...a.files, ...b.files])].sort() }
}

function joinPasswordLists(sources: PasswordListSource[]): PasswordListSource[] {
  if (sources.length <= 1) return sources.slice()

  const pending = sources.slice()
  const joined: PasswordListSource[] = []

  while (pending.length > 0) {
    const current = pending.shift()!

    let merged = false
    for (let i = 0; i < pending.length; i++) {
      // try current → pending[i]
      const resultA = tryMergeLists(current, pending[i]!, 1)
      if (resultA) {
        pending.splice(i, 1)
        pending.unshift(resultA)
        merged = true
        break
      }
      // try pending[i] → current
      const resultB = tryMergeLists(pending[i]!, current, 1)
      if (resultB) {
        pending.splice(i, 1)
        pending.unshift(resultB)
        merged = true
        break
      }
    }

    if (!merged) {
      joined.push(current)
    }
  }

  return joined
}

function renderPasswordListSection(
  log: ReturnType<typeof createTailLog>,
  groups: ContentGroup[]
): void {
  const sources = extractPasswordLists(groups)
  if (sources.length === 0) return

  const joined = joinPasswordLists(sources)

  log.section(`Password Lists (${sources.length} raw list(s) → ${joined.length} joined)`)

  const sorted = joined.sort((a, b) => b.words.length - a.words.length)
  const previewLen = Math.min(120, Number(W.notesWide))

  const rows = sorted.map((joinedList, joinedIdx) => {
    const joinedSet = new Set(joinedList.words)

    // cross-list overlap: words in this joined list that also appear in other joined lists
    let crossOverlap = 0
    for (let otherIdx = 0; otherIdx < sorted.length; otherIdx++) {
      if (otherIdx === joinedIdx) continue
      for (const word of sorted[otherIdx]!.words) {
        if (joinedSet.has(word)) crossOverlap++
      }
    }

    // coverage: how many source lists are contiguous subsequences of this joined list
    let sourcesContained = 0
    for (const source of sources) {
      if (isContiguousSubsequence(joinedList.words, source.words)) {
        sourcesContained++
      }
    }

    return [
      joinedList.words.join(", ").slice(0, previewLen) + (joinedList.words.join(", ").length > previewLen ? "..." : ""),
      String(joinedList.words.length),
      String(crossOverlap),
      `${sourcesContained}/${sources.length}`,
      joinedList.files.map(fileBaseName).join(", "),
    ]
  })

  log.table({
    columns: PASSWORD_LIST_COLUMNS,
    rows,
  })

  // Emit the longest joined list as a copy-paste TypeScript array
  if (sorted.length > 0) {
    const best = sorted[0]!
    const lines = best.words.map((w) => `  "${w}",`)
    const block = `// ${best.words.length} password(s) merged from ${sources.length} snapshot(s)\nconst DARKWEB_COMMON_PASSWORDS: readonly string[] = [\n${lines.join("\n")}\n]`
    log.text("Copy-paste into darknetCrawl.ts DARKWEB_COMMON_PASSWORDS:")
    log.text(block)
  }
}

function buildRows(groups: ContentGroup[]): string[][] {
  return groups.map((group) => [
    group.preview,
    String(group.files.length),
    group.files.map(fileBaseName).join(", "),
  ])
}

interface DarknetSocialFile {
  version: 1
  entries: string[]
}

function saveJournalingJson(ns: NS, groups: ContentGroup[]): void {
  const entries = groups
    .map((g) => g.fullContent.trim())
    .filter(Boolean)
    .sort()
  ns.write(DARKNET_TEXT_FILE, JSON.stringify(entries, null, 2), "w")
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

  // Persist deduplicated journaling/social hints as a separate ordered JSON file
  if (journalingGroups.length > 0) {
    saveJournalingJson(ns, journalingGroups)
  }

  const total = files.length
  const socialCount = journalingGroups.length
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
  if (socialCount > 0) {
    log.text(`Saved ${socialCount} unique entries to ${DARKNET_TEXT_FILE}`)
  }

  const shown = [
    renderGroupTable(log, "Journaling", journalingGroups, journalingDupGroups.length, journalingTotalFiles),
    renderGroupTable(log, "Other", otherGroups, otherDupGroups.length, otherTotalFiles),
  ]

  renderPasswordListSection(log, otherGroups)

  renderHostCheckSection(log, otherGroups)

  if (shown.every((n) => n === 0)) {
    log.text("No content groups to display.")
  }

  await log.render(ns)
}
