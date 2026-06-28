// Thin entry point — re-exports everything consumers need.
// The worker entry is now darknet/worker.js (spawned by the master).
// This file exists solely for the master path and for re-exporting to darkwebStats.ts / darkwebArchiveDupes.ts.
// Uses import-then-export (not export-from) because viteburner only rewrites top-level import paths.

import {
  DARKNET_CRAWL_SCRIPT,
  DARKNET_REGISTRY_FILE,
  DEFAULT_CRAWL_INTERVAL_MS,
  DARKWEB,
  LORE_FILE_KEYWORDS,
  PASSWORD_FILE_KEYWORDS,
  isLoreFile,
  isPasswordFile,
  flatFileName,
  formatEtaMs,
  formatCrawlOpShort,
  formatCrawlStatusLine,
  safeGetServerDetails,
  tryConnectToSession,
} from "./darknet/config"
import type {
  CrawlCacheOpen,
  CrawlHostReport,
  CrawlProgressState,
  CrawlStatusReport,
  DarknetCrawlApi,
  DarknetRegistry,
  DarknetRegistryEntry,
  DarknetRememberedPassword,
  DarknetServerDetailsForFormulas,
  TaskSnapshot,
} from "./darknet/config"

export {
  DARKNET_CRAWL_SCRIPT,
  DARKNET_REGISTRY_FILE,
  DEFAULT_CRAWL_INTERVAL_MS,
  DARKWEB,
  LORE_FILE_KEYWORDS,
  PASSWORD_FILE_KEYWORDS,
  isLoreFile,
  isPasswordFile,
  flatFileName,
  formatEtaMs,
  formatCrawlOpShort,
  formatCrawlStatusLine,
  safeGetServerDetails,
  tryConnectToSession,
}

export type {
  CrawlCacheOpen,
  CrawlHostReport,
  CrawlProgressState,
  CrawlStatusReport,
  DarknetCrawlApi,
  DarknetRegistry,
  DarknetRegistryEntry,
  DarknetRememberedPassword,
  DarknetServerDetailsForFormulas,
  TaskSnapshot,
}

import {
  loadDarknetRegistry,
  saveDarknetRegistry,
  mergeCrawlReportsIntoRegistry,
  mergeRegistryWithCrawl,
  pruneInvalidRegistryHosts,
  applyPasswordIntel,
} from "./darknet/registry"

export {
  loadDarknetRegistry,
  saveDarknetRegistry,
  mergeCrawlReportsIntoRegistry,
  mergeRegistryWithCrawl,
  pruneInvalidRegistryHosts,
  applyPasswordIntel,
}

import { runDarknetCrawl, killAllCrawlWorkers } from "./darknet/master"

export { runDarknetCrawl, killAllCrawlWorkers }
