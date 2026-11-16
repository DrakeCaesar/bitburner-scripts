/*
 * Shared JS helpers for the browser tools (see toolUi.css for the matching styles).
 *
 * Plain script, no modules: the pages are opened straight from disk, where ES module
 * imports are blocked by CORS but classic scripts, blob workers and <link> styles work.
 *
 * Exposes window.ToolUi.
 */
;(function (global) {
  "use strict"

  const ToolUi = {}

  ToolUi.el = (id) => document.getElementById(id)

  // ---- storage -------------------------------------------------------------
  // Settings survive reloads in localStorage. Every access is guarded: file:// pages
  // and privacy modes can throw on access, and a tool should still run without it.

  ToolUi.store = {
    read(key, fallback) {
      try {
        const raw = global.localStorage.getItem(key)
        return raw === null ? fallback : JSON.parse(raw)
      } catch {
        return fallback
      }
    },
    write(key, value) {
      try {
        global.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* storage unavailable */
      }
    },
    remove(key) {
      try {
        global.localStorage.removeItem(key)
      } catch {
        /* storage unavailable */
      }
    },
  }

  // ---- form values ---------------------------------------------------------
  // An empty input shows its default as a grey placeholder and the typed value is white,
  // so "is this still the default?" needs no extra state: value === "" means default.

  function element(inputOrId) {
    return typeof inputOrId === "string" ? document.getElementById(inputOrId) : inputOrId
  }

  /** Numeric value of an input, falling back to data-default or the placeholder. */
  ToolUi.numberOf = (inputOrId) => {
    const input = element(inputOrId)
    if (!input) return NaN
    const raw = String(input.value ?? "").trim()
    if (raw !== "") return Number(raw)
    const fallback = input.dataset ? input.dataset.default : undefined
    return Number(fallback !== undefined && fallback !== "" ? fallback : input.placeholder)
  }

  /** Text value of an input, falling back to the placeholder. */
  ToolUi.textOf = (inputOrId) => {
    const input = element(inputOrId)
    if (!input) return ""
    const raw = String(input.value ?? "").trim()
    return raw !== "" ? raw : String(input.placeholder ?? "")
  }

  /** True when the control still shows its default (empty input, or the original option). */
  ToolUi.isDefault = (inputOrId) => {
    const input = element(inputOrId)
    if (!input) return true
    if (input.type === "checkbox") return input.checked === (input.dataset.checked === "1")
    if (input.tagName === "SELECT") return input.value === (input.dataset.value ?? input.value)
    return String(input.value ?? "").trim() === ""
  }

  /**
   * Persist every control with an id inside `scope` (default: document).
   * Opt a control out with data-nopersist. Returns { restore, save, clear }.
   */
  ToolUi.persist = (key, scope) => {
    const root = scope ?? document
    const controls = () =>
      Array.from(root.querySelectorAll("input[id], select[id], textarea[id]")).filter(
        (control) => !control.dataset.nopersist
      )

    const save = () => {
      const state = {}
      for (const control of controls()) {
        state[control.id] = control.type === "checkbox" ? { c: control.checked } : { v: control.value }
      }
      ToolUi.store.write(key, state)
    }

    const restore = () => {
      const state = ToolUi.store.read(key, null)
      if (!state) return false
      for (const control of controls()) {
        const saved = state[control.id]
        if (!saved) continue
        if (control.type === "checkbox") control.checked = Boolean(saved.c)
        else if (saved.v !== undefined) control.value = saved.v
      }
      return true
    }

    const clear = () => {
      ToolUi.store.remove(key)
      for (const control of controls()) {
        if (control.type === "checkbox") control.checked = control.dataset.checked === "1"
        else if (control.tagName === "SELECT") control.value = control.dataset.value ?? control.value
        else control.value = ""
      }
    }

    for (const control of controls()) {
      control.addEventListener("input", save)
      control.addEventListener("change", save)
    }
    return { save, restore, clear }
  }

  // ---- number formatting ---------------------------------------------------

  function trimZeros(text) {
    return text.includes(".") ? text.replace(/\.?0+$/, "") : text
  }

  const SUFFIXES = ["", "k", "m", "b", "t", "q"]

  /** Compact money/number text, e.g. 124068000000 -> "124.068b". */
  ToolUi.format = {
    number(value, digits) {
      if (!Number.isFinite(value)) return "n/a"
      const negative = value < 0
      let scaled = Math.abs(value)
      let suffix = 0
      while (scaled >= 1000 && suffix < SUFFIXES.length - 1) {
        scaled /= 1000
        suffix++
      }
      const precision = digits === undefined ? 3 : digits
      return `${negative ? "-" : ""}${trimZeros(scaled.toFixed(precision))}${SUFFIXES[suffix]}`
    },
    money(value, digits) {
      return `${value < 0 ? "-" : ""}$${ToolUi.format.number(Math.abs(value), digits)}`
    },
    signedMoney(value, digits) {
      return `${value >= 0 ? "+" : "-"}$${ToolUi.format.number(Math.abs(value), digits)}`
    },
    pct(value, digits) {
      return `${(value * 100).toFixed(digits === undefined ? 1 : digits)}%`
    },
    signedPct(value, digits) {
      const d = digits === undefined ? 2 : digits
      return `${value >= 0 ? "+" : "-"}${(Math.abs(value) * 100).toFixed(d)}%`
    },
    ratio(value, digits) {
      return Number.isFinite(value) ? `${value.toFixed(digits === undefined ? 2 : digits)}x` : "n/a"
    },
  }

  ToolUi.tone = (value) => (value >= 0 ? "pos" : "neg")

  /** Fill a .cards container from [{ k, v, tone }]. */
  ToolUi.setCards = (container, cards) => {
    const root = typeof container === "string" ? document.getElementById(container) : container
    root.innerHTML = ""
    for (const card of cards) {
      const box = document.createElement("div")
      box.className = "card"
      const key = document.createElement("div")
      key.className = "k"
      key.textContent = card.k
      const value = document.createElement("div")
      value.className = `v ${card.tone ?? ""}`.trim()
      value.textContent = card.v
      box.append(key, value)
      root.appendChild(box)
    }
  }

  /** Set a status line. Pill elements keep their shape and turn red on error; others use .err. */
  ToolUi.setStatus = (nodeOrId, text, kind) => {
    const node = typeof nodeOrId === "string" ? document.getElementById(nodeOrId) : nodeOrId
    if (!node) return
    const failed = kind === "error"
    if (node.classList.contains("pill")) {
      node.classList.toggle("failed", failed)
      node.classList.toggle("dim", !failed)
    } else {
      node.className = failed ? "err" : "dim"
    }
    node.textContent = text
  }

  /** Most workers worth starting: the core count, capped. */
  ToolUi.coreCount = () => Math.max(1, Math.min(12, global.navigator?.hardwareConcurrency || 4))

  /**
   * Blob-backed worker pool. `source` is the full worker script text. Jobs are handed out
   * one at a time as workers free up, so uneven run times stay balanced.
   *
   *   const pool = ToolUi.pool(source, 8)   // null when workers are unavailable
   *   const results = await pool.map(jobs, (done, total) => ...)
   */
  ToolUi.pool = (source, requestedSize) => {
    if (typeof global.Worker !== "function" || typeof global.Blob !== "function") return null
    const size = Math.max(1, Math.floor(requestedSize) || 1)
    let url
    try {
      url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
    } catch {
      return null
    }

    const workers = []
    for (let i = 0; i < size; i++) {
      try {
        workers.push(new Worker(url))
      } catch {
        break
      }
    }
    if (workers.length === 0) {
      URL.revokeObjectURL(url)
      return null
    }

    const pool = {
      size: workers.length,
      map(jobs, onProgress) {
        if (jobs.length === 0) return Promise.resolve([])
        const results = new Array(jobs.length)
        let next = 0
        let done = 0
        let settled = false

        return new Promise((resolve, reject) => {
          const start = (worker) => {
            if (settled || next >= jobs.length) return
            const index = next++
            worker.postMessage({ index, job: jobs[index] })
          }
          for (const worker of workers) {
            worker.onmessage = (event) => {
              if (settled) return
              const { index, result, error } = event.data ?? {}
              if (error) {
                settled = true
                reject(new Error(error))
                return
              }
              results[index] = result
              done++
              if (onProgress) onProgress(done, jobs.length)
              if (done === jobs.length) {
                settled = true
                resolve(results)
              } else {
                start(worker)
              }
            }
            worker.onerror = (event) => {
              if (settled) return
              settled = true
              reject(event.error ?? new Error(event.message || "worker failed"))
            }
            start(worker)
          }
        })
      },
      terminate() {
        for (const worker of workers) worker.terminate()
        URL.revokeObjectURL(url)
      },
    }
    return pool
  }

  global.ToolUi = ToolUi
})(window)
