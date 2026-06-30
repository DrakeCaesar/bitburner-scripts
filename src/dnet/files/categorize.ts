/** Server file categorization (ported from darknet/config.ts). */

export const DARKNET_LORE_FILE = "darknet-lore.json"
export const DARKWEB_ARCHIVE_DIR = "darkweb"

/** Files whose basename contains one of these go to the lore port -> darknet-lore.json. */
export const LORE_FILE_KEYWORDS = [
  "dreams",
  "journal",
  "notes",
  "search_history",
  "the_truth",
  "thoughts",
]

/** Parsed for password intel but not archived to disk. */
export const PASSWORD_FILE_KEYWORDS = [
  "access",
  "admin",
  "credentials",
  "key",
  "login",
  "password",
  "root",
  "secrets",
]

export function flatFileName(fileName: string): string {
  return fileName.includes("/") ? (fileName.split("/").pop() ?? fileName) : fileName
}

export function isLoreFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return LORE_FILE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function isPasswordFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return PASSWORD_FILE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function isCacheFile(fileName: string): boolean {
  return flatFileName(fileName).endsWith(".cache")
}
