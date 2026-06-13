/**
 * Patches viteburner WsAdapter to fix HMR races when many files change at once.
 *
 * Root cause: each chokidar event calls handleHmrMessage() without awaiting the
 * previous run, so dependents can upload while Vite still serves stale dependency
 * transforms (blob: URLs / missing exports).
 *
 * Fix: debounce + serialize uploads, propagate importers on "change", invalidate
 * dependency modules before transform, upload in dependency-first order.
 */
const { resolve, relative } = require("node:path")
const { WsAdapter, logger } = require("viteburner")

const UPLOAD_DEBOUNCE_MS = 80

function slash(str) {
  return str.replace(/\\/g, "/")
}

function fixGamePaths(content) {
  return content
    .replace(/\/src\/libraries\//g, "/libraries/")
    .replace(/(\/libraries\/[^'"]+)\.ts(?=['"])/g, "$1.js")
}

function viteIdToProjectFile(server, id) {
  const root = slash(resolve(server.config.root))
  let normalized = slash(id).replace(/\?.*$/, "")
  if (normalized.startsWith("/@fs")) {
    normalized = normalized.slice("/@fs".length)
  }
  if (normalized.startsWith(root)) {
    return slash(relative(server.config.root, normalized))
  }
  return null
}

async function collectDependencyFiles(server, file, filesInBatch, depMap, visited = new Set()) {
  if (visited.has(file)) return
  visited.add(file)

  const id = server.pathToId(file)
  const mod = await server.moduleGraph.getModuleByUrl(id)
  if (!mod) return

  const deps = depMap.get(file) ?? new Set()
  depMap.set(file, deps)

  for (const imported of mod.importedModules) {
    if (!imported.id) continue
    const depFile = viteIdToProjectFile(server, imported.id)
    if (!depFile || depFile === file) continue
    if (filesInBatch.has(depFile)) {
      deps.add(depFile)
    }
    await collectDependencyFiles(server, depFile, filesInBatch, depMap, visited)
  }
}

function topoSortItems(items, depMap) {
  const byFile = new Map(items.map((item) => [item.file, item]))
  const files = new Set(byFile.keys())
  const inDegree = new Map([...files].map((file) => [file, 0]))
  const dependents = new Map()

  for (const file of files) {
    for (const dep of depMap.get(file) ?? []) {
      if (!files.has(dep)) continue
      inDegree.set(file, (inDegree.get(file) ?? 0) + 1)
      if (!dependents.has(dep)) dependents.set(dep, new Set())
      dependents.get(dep).add(file)
    }
  }

  const queue = [...files].filter((file) => (inDegree.get(file) ?? 0) === 0)
  queue.sort((a, b) => a.localeCompare(b))

  const ordered = []
  while (queue.length) {
    const file = queue.shift()
    ordered.push(byFile.get(file))
    for (const dependent of dependents.get(file) ?? []) {
      const next = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, next)
      if (next === 0) {
        queue.push(dependent)
        queue.sort((a, b) => a.localeCompare(b))
      }
    }
  }

  if (ordered.length !== items.length) {
    const missing = items.filter((item) => !ordered.includes(item))
    missing.sort((a, b) => {
      const aLib = a.file.includes("libraries/") ? 0 : 1
      const bLib = b.file.includes("libraries/") ? 0 : 1
      if (aLib !== bLib) return aLib - bLib
      return a.file.localeCompare(b.file)
    })
    return [...ordered, ...missing]
  }

  return ordered
}

async function sortForUpload(server, items) {
  const transformItems = items.filter((item) => item.transform)
  const passthrough = items.filter((item) => !item.transform)
  const filesInBatch = new Set(items.map((item) => item.file))
  const depMap = new Map()

  for (const item of transformItems) {
    await collectDependencyFiles(server, item.file, filesInBatch, depMap)
  }

  return [...topoSortItems(transformItems, depMap), ...passthrough]
}

async function invalidateDependencyTree(server, file, visited = new Set()) {
  if (visited.has(file)) return
  visited.add(file)

  const id = server.pathToId(file)
  const mod = await server.moduleGraph.getModuleByUrl(id)
  if (!mod) {
    await server.invalidateFile(file)
    return
  }

  for (const imported of mod.importedModules) {
    if (!imported.id) continue
    const depFile = viteIdToProjectFile(server, imported.id)
    if (depFile?.startsWith("src/")) {
      await invalidateDependencyTree(server, depFile, visited)
    }
  }

  await server.invalidateFile(file)
}

async function augmentWithImporters(server, data) {
  const root = server.config.root
  const seen = new Set(data.map((item) => item.file))
  const extra = []

  for (const item of data) {
    if (item.event === "unlink") continue

    const changedId = server.pathToId(item.file)
    const changedMod = await server.moduleGraph.getModuleByUrl(changedId)
    if (!changedMod) continue

    for (const mod of server.moduleGraph.idToModuleMap.values()) {
      if (!mod.file) continue

      const importer = slash(relative(root, mod.file))
      if (!importer.startsWith("src/") || seen.has(importer)) continue

      let importsChanged = false
      for (const dep of mod.importedModules) {
        if (dep.id === changedMod.id) {
          importsChanged = true
          break
        }
      }
      if (!importsChanged) continue

      const importerData = server.watchManager.findItem(importer)
      if (!importerData?.transform) continue

      seen.add(importer)
      extra.push({
        file: importer,
        timestamp: item.timestamp,
        initial: item.initial,
        event: "change",
        ...importerData,
      })
    }
  }

  return extra.length ? [...data, ...extra] : data
}

function applyViteburnerHmrPatch() {
  const originalCheckDependencies = WsAdapter.prototype.checkDependencies
  const originalFixImport = WsAdapter.prototype.fixImport
  const originalFetchModule = WsAdapter.prototype.fetchModule

  WsAdapter.prototype.checkDependencies = async function checkDependencies(data) {
    const withViteImporters = await originalCheckDependencies.call(this, data)
    return augmentWithImporters(this.server, withViteImporters)
  }

  WsAdapter.prototype.fixImport = function fixImport(content, data, serverName) {
    const fixed = originalFixImport.call(this, content, data, serverName)
    return fixGamePaths(fixed)
  }

  WsAdapter.prototype.fetchModule = async function fetchModule(data) {
    if (data.transform) {
      await invalidateDependencyTree(this.server, data.file)
    }

    let content = await originalFetchModule.call(this, data)
    if (/from\s*['"]blob:/.test(content)) {
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 50))
      await invalidateDependencyTree(this.server, data.file)
      content = await originalFetchModule.call(this, data)
      if (/from\s*['"]blob:/.test(content)) {
        throw new Error(`stale transform for ${data.file} (blob import); dependency graph not ready`)
      }
    }
    return content
  }

  WsAdapter.prototype.handleHmrMessage = async function handleHmrMessage(data) {
    const isDrain = !data || (Array.isArray(data) && data.length === 0)

    if (!isDrain) {
      if (!Array.isArray(data)) data = [data]
      data = await this.checkDependencies(data)

      for (const item of data) {
        this.buffers.set(item.file, item)
      }
      for (const item of data) {
        logger.info(`hmr ${item.event}`, item.file, "(pending)")
      }
    }

    if (!this.manager.connected) return

    if (!this._hmrFlushPromise) {
      this._hmrFlushPromise = Promise.resolve()
    }

    this._hmrFlushPromise = this._hmrFlushPromise.then(() => this._scheduleHmrFlush(isDrain))
    await this._hmrFlushPromise
  }

  WsAdapter.prototype._scheduleHmrFlush = async function _scheduleHmrFlush(immediate) {
    if (this._hmrFlushTimer) {
      clearTimeout(this._hmrFlushTimer)
      this._hmrFlushTimer = undefined
    }

    if (!immediate) {
      await new Promise((resolveFlush) => {
        this._hmrFlushTimer = setTimeout(resolveFlush, UPLOAD_DEBOUNCE_MS)
      })
    }

    while (this.buffers.size) {
      const pending = [...this.buffers.values()]
      const ordered = await sortForUpload(this.server, pending)

      for (const item of ordered) {
        const latest = this.buffers.get(item.file)
        if (!latest) continue
        await this.uploadFile(latest)
      }
    }
  }
}

module.exports = { applyViteburnerHmrPatch }
