import { type ReactNode } from "@ns"
import { getReact } from "@/libraries/scriptLogUi.js"
import {
  buildMapGrid,
  exploredCellCount,
  frontierCells,
  globalFrontierRemaining,
  sessionDisplayCoords,
  type LabyrinthState,
  type MapGrid,
  type MapGridChar,
} from "../solvers/labyrinth.js"
import type { LabyrinthMapSnapshot, WorkerSnapshot } from "../types.js"

const WORKER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

const WORKER_COLORS = [
  "#4fc3f7",
  "#81c784",
  "#ffb74d",
  "#e57373",
  "#ba68c8",
  "#4db6ac",
  "#fff176",
  "#90a4ae",
] as const

const CELL_STYLES: Record<MapGridChar, { bg: string; fg: string; char: string }> = {
  wall: { bg: "#1a1a1a", fg: "#555", char: "#" },
  open: { bg: "#2a2a2a", fg: "#ccc", char: " " },
  unknown: { bg: "#111", fg: "#333", char: "?" },
  worker: { bg: "#1565c0", fg: "#fff", char: "@" },
  frontier: { bg: "#1b3a1b", fg: "#8bc34a", char: "?" },
  claimed: { bg: "#3e2723", fg: "#ffcc80", char: "!" },
}

export interface LabyrinthOverviewContext {
  stasisLinked?: readonly string[]
  workers?: readonly WorkerSnapshot[]
}

function workerColor(index: number): string {
  return WORKER_COLORS[index % WORKER_COLORS.length]!
}

function workerLetter(index: number): string {
  return WORKER_LETTERS[index] ?? String(index + 1)
}

function shortenHost(host: string, max = 22): string {
  if (host.length <= max) return host
  return `${host.slice(0, max - 3)}...`
}

function claimForWorker(state: LabyrinthState, workerHost: string): string | null {
  const claims = state.claims ?? {}
  for (const [cell, host] of Object.entries(claims)) {
    if (host === workerHost) return cell
  }
  return null
}

interface WorkerRow {
  letter: string
  color: string
  host: string
  stasis: boolean
  pos: string
  phase: string
  pending: string
  claim: string
  pathDepth: number
  /** idle | busy | offline (not in worker pool) */
  poolState: "idle" | "busy" | "offline"
  /** labyrinth dispatch eligibility */
  availability: "available" | "active" | "unavailable" | "offline"
  availabilityLabel: string
  inSession: boolean
  labAdjacent: boolean
}

function isLabAdjacent(host: string, labHost: string, snap: WorkerSnapshot | undefined): boolean {
  if (!snap) return false
  return snap.host === labHost || snap.neighbors.includes(labHost)
}

function workerAvailability(
  snap: WorkerSnapshot | undefined,
  labHost: string,
  pending: string,
  inSession: boolean,
): Pick<WorkerRow, "availability" | "availabilityLabel" | "poolState" | "labAdjacent"> {
  const labAdjacent = isLabAdjacent(snap?.host ?? "", labHost, snap)
  if (!snap) {
    return {
      poolState: "offline",
      labAdjacent: false,
      availability: "offline",
      availabilityLabel: inSession ? "offline (session stale)" : "offline",
    }
  }

  const poolState: WorkerRow["poolState"] = snap.idle ? "idle" : "busy"
  if (!labAdjacent) {
    return {
      poolState,
      labAdjacent: false,
      availability: "unavailable",
      availabilityLabel: snap.idle ? "unavailable (not adjacent)" : "unavailable (busy, not adjacent)",
    }
  }

  if (pending || !snap.idle) {
    const detail = pending ? `active (${pending})` : `active (${snap.lastCommand ?? "busy"})`
    return { poolState, labAdjacent: true, availability: "active", availabilityLabel: detail }
  }

  return {
    poolState,
    labAdjacent: true,
    availability: "available",
    availabilityLabel: "available",
  }
}

function buildWorkerRows(state: LabyrinthState, ctx: LabyrinthOverviewContext, labHost: string): WorkerRow[] {
  const workerSnap = new Map((ctx.workers ?? []).map((w) => [w.host, w]))
  const stasis = new Set(ctx.stasisLinked ?? [])
  const sessionHosts = Object.keys(state.sessions).sort()
  const seen = new Set<string>()

  const rows: WorkerRow[] = sessionHosts.map((host, i) => {
    seen.add(host)
    const sess = state.sessions[host]!
    const pos = sessionDisplayCoords(sess)
    const snap = workerSnap.get(host)
    const claim = claimForWorker(state, host)
    const pending = state.pending?.[host] ?? ""
    const avail = workerAvailability(snap, labHost, pending, true)

    return {
      letter: workerLetter(i),
      color: workerColor(i),
      host,
      stasis: stasis.has(host),
      pos: pos ? pos.join(",") : "-",
      phase: sess.phase,
      pending: pending || "-",
      claim: claim ?? "-",
      pathDepth: sess.path.length,
      inSession: true,
      ...avail,
    }
  })

  const poolHosts = [...workerSnap.keys()].filter((h) => !seen.has(h)).sort()
  for (const host of poolHosts) {
    const snap = workerSnap.get(host)!
    if (!isLabAdjacent(host, labHost, snap)) continue
    const avail = workerAvailability(snap, labHost, "", false)
    rows.push({
      letter: "-",
      color: "#444",
      host,
      stasis: stasis.has(host),
      pos: "-",
      phase: "-",
      pending: "-",
      claim: "-",
      pathDepth: 0,
      inSession: false,
      ...avail,
    })
  }

  return rows
}

function logicalCellAt(grid: MapGrid, gx: number, gy: number): string | null {
  if (gx % 2 !== 0 || gy % 2 !== 0) return null
  const logicalX = grid.minX + (gx / 2) * 2
  const logicalY = grid.minY + (gy / 2) * 2
  return `${logicalX},${logicalY}`
}

function renderMapGrid(
  React: ReturnType<typeof getReact>,
  grid: MapGrid,
  workerRows: WorkerRow[],
): ReactNode {
  const letterToColor = new Map(workerRows.map((w) => [w.letter, w.color]))

  const rows = grid.cells.map((row, gy) =>
    React.createElement(
      "div",
      { key: `r-${gy}`, style: { display: "flex", flexDirection: "row", lineHeight: 1 } },
      row.map((kind, gx) => {
        let displayKind = kind
        let letter: string | undefined
        let bg = CELL_STYLES[displayKind].bg
        let fg = CELL_STYLES[displayKind].fg

        const logicalKey = logicalCellAt(grid, gx, gy)
        if (logicalKey && (kind === "worker" || kind === "open")) {
          const w = grid.workerMarkers.get(logicalKey)
          if (w) {
            displayKind = "worker"
            letter = w === "*" ? "*" : w
            bg = letterToColor.get(w) ?? CELL_STYLES.worker.bg
            fg = "#000"
          }
        } else if (logicalKey && kind === "claimed") {
          letter = grid.claimMarkers.get(logicalKey)
          if (letter) {
            bg = letterToColor.get(letter) ?? CELL_STYLES.claimed.bg
            fg = "#000"
          }
        }

        const style = CELL_STYLES[displayKind]
        return React.createElement(
          "span",
          {
            key: `c-${gx}-${gy}`,
            style: {
              fontFamily: "monospace",
              fontSize: "11px",
              width: "12px",
              height: "12px",
              lineHeight: "12px",
              display: "inline-block",
              textAlign: "center",
              backgroundColor: bg,
              color: fg,
              border: "1px solid rgba(255,255,255,0.04)",
              boxSizing: "border-box",
            },
            title: logicalKey ?? undefined,
          },
          letter ?? style.char,
        )
      }),
    ),
  )

  return React.createElement(
    "div",
    {
      key: "map",
      style: {
        display: "inline-block",
        border: "1px solid rgba(255,255,255,0.12)",
        padding: 4,
        backgroundColor: "#0d0d0d",
      },
    },
    rows,
  )
}

function renderWorkerPanel(React: ReturnType<typeof getReact>, rows: WorkerRow[]): ReactNode {
  if (rows.length === 0) {
    return React.createElement(
      "div",
      { style: { fontFamily: "monospace", opacity: 0.7, fontSize: "11px" } },
      "No explorers assigned",
    )
  }

  const header = React.createElement(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: "24px 1fr 36px 52px 64px 56px 52px 36px 1fr",
        gap: "4px",
        fontWeight: "bold",
        fontSize: "10px",
        opacity: 0.75,
        marginBottom: 4,
        fontFamily: "monospace",
      },
    },
    ["", "Host", "Stasis", "Pos", "Phase", "Pending", "Claim", "Path", "Status"].map((label, i) =>
      React.createElement("span", { key: `h-${i}` }, label),
    ),
  )

  const body = rows.map((row) =>
    React.createElement(
      "div",
      {
        key: row.host,
        style: {
          display: "grid",
          gridTemplateColumns: "24px 1fr 36px 52px 64px 56px 52px 36px 1fr",
          gap: "4px",
          fontSize: "10px",
          fontFamily: "monospace",
          marginBottom: 2,
          alignItems: "center",
        },
      },
      [
        React.createElement(
          "span",
          {
            key: "letter",
            style: {
              backgroundColor: row.inSession ? row.color : "#333",
              color: row.inSession ? "#000" : "#888",
              fontWeight: "bold",
              textAlign: "center",
              borderRadius: 2,
            },
          },
          row.letter,
        ),
        React.createElement("span", { key: "host", title: row.host }, shortenHost(row.host, 28)),
        React.createElement("span", { key: "stasis" }, row.stasis ? "yes" : "no"),
        React.createElement("span", { key: "pos" }, row.pos),
        React.createElement("span", { key: "phase" }, row.phase),
        React.createElement("span", { key: "pending" }, row.pending),
        React.createElement("span", { key: "claim" }, row.claim),
        React.createElement("span", { key: "path" }, row.inSession ? String(row.pathDepth) : "-"),
        React.createElement(
          "span",
          {
            key: "status",
            style: {
              opacity: row.availability === "available" ? 1 : row.availability === "active" ? 1 : 0.65,
            },
          },
          row.availabilityLabel,
        ),
      ],
    ),
  )

  return React.createElement(
    "div",
    { style: { minWidth: 420, maxWidth: 560 } },
    header,
    ...body,
  )
}

function renderStats(
  React: ReturnType<typeof getReact>,
  snapshot: LabyrinthMapSnapshot,
  state: LabyrinthState,
  frontierCount: number,
): ReactNode {
  const explored = exploredCellCount(state.map)
  const pendingCount = Object.keys(state.pending ?? {}).length
  const claimCount = Object.keys(state.claims ?? {}).length
  const explorers = Object.keys(state.sessions).length
  const frontierOpen = globalFrontierRemaining(state.map)

  const parts = [
    snapshot.hostname,
    `status ${snapshot.status}`,
    `explored ${explored}`,
    `frontier ${frontierCount}${frontierOpen ? "" : " (done)"}`,
    `claims ${claimCount}`,
    `pending ${pendingCount}`,
    `explorers ${explorers}`,
  ]

  return React.createElement(
    "div",
    {
      style: {
        fontFamily: "monospace",
        fontSize: "11px",
        marginBottom: 6,
        lineHeight: 1.4,
      },
    },
    parts.join("  |  "),
  )
}

function availabilitySummary(rows: WorkerRow[]): string {
  let available = 0
  let active = 0
  let unavailable = 0
  let offline = 0
  for (const row of rows) {
    if (row.availability === "available") available++
    else if (row.availability === "active") active++
    else if (row.availability === "unavailable") unavailable++
    else offline++
  }
  return `available ${available}  active ${active}  unavailable ${unavailable}  offline ${offline}`
}

function renderLegend(React: ReturnType<typeof getReact>, workerRows: WorkerRow[]): ReactNode {
  const mapSymbols = [
    "# wall",
    "space corridor",
    "? unknown / open frontier",
    "! claimed frontier (letter = owner)",
    "A-Z explorer on map",
  ]

  const sessionRows = workerRows.filter((r) => r.inSession)
  const poolRows = workerRows.filter((r) => !r.inSession)

  const sessionLegend =
    sessionRows.length === 0
      ? React.createElement("div", { key: "no-session", style: { opacity: 0.7 } }, "No explorers in maze yet")
      : React.createElement(
          "div",
          { key: "session-legend" },
          sessionRows.map((row) =>
            React.createElement(
              "div",
              {
                key: row.host,
                style: {
                  display: "flex",
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 3,
                },
              },
              [
                React.createElement(
                  "span",
                  {
                    key: "badge",
                    style: {
                      backgroundColor: row.color,
                      color: "#000",
                      fontWeight: "bold",
                      width: 18,
                      textAlign: "center",
                      borderRadius: 2,
                    },
                  },
                  row.letter,
                ),
                React.createElement(
                  "span",
                  { key: "host", style: { minWidth: 140 }, title: row.host },
                  shortenHost(row.host, 24),
                ),
                React.createElement(
                  "span",
                  { key: "stasis", style: { width: 52, opacity: 0.85 } },
                  row.stasis ? "stasis" : "",
                ),
                React.createElement("span", { key: "status" }, row.availabilityLabel),
              ],
            ),
          ),
        )

  const poolLegend =
    poolRows.length === 0
      ? null
      : React.createElement(
          "div",
          { key: "pool-legend", style: { marginTop: 6 } },
          [
            React.createElement(
              "div",
              { key: "pool-hdr", style: { opacity: 0.75, marginBottom: 3 } },
              "Adjacent pool workers (not exploring):",
            ),
            ...poolRows.map((row) =>
              React.createElement(
                "div",
                { key: row.host, style: { display: "flex", flexDirection: "row", gap: 8, marginBottom: 2 } },
                [
                  React.createElement("span", { key: "dash", style: { width: 18, textAlign: "center" } }, "-"),
                  React.createElement(
                    "span",
                    { key: "host", style: { minWidth: 140 }, title: row.host },
                    shortenHost(row.host, 24),
                  ),
                  React.createElement(
                    "span",
                    { key: "stasis", style: { width: 52, opacity: 0.85 } },
                    row.stasis ? "stasis" : "",
                  ),
                  React.createElement("span", { key: "status" }, row.availabilityLabel),
                ],
              ),
            ),
          ],
        )

  return React.createElement(
    "div",
    {
      style: {
        fontFamily: "monospace",
        fontSize: "10px",
        marginTop: 8,
        padding: 6,
        border: "1px solid rgba(255,255,255,0.1)",
        backgroundColor: "rgba(255,255,255,0.02)",
      },
    },
    [
      React.createElement("div", { key: "hdr", style: { fontWeight: "bold", marginBottom: 4 } }, "Legend"),
      React.createElement("div", { key: "symbols", style: { opacity: 0.85, marginBottom: 6 } }, mapSymbols.join("  |  ")),
      React.createElement(
        "div",
        { key: "summary", style: { marginBottom: 6, opacity: 0.9 } },
        availabilitySummary(workerRows),
      ),
      React.createElement("div", { key: "workers-hdr", style: { opacity: 0.75, marginBottom: 3 } }, "Map workers:"),
      sessionLegend,
      poolLegend,
    ].filter(Boolean),
  )
}

function buildLabyrinthMapReact(
  snapshot: LabyrinthMapSnapshot,
  ctx: LabyrinthOverviewContext,
): ReactNode {
  const React = getReact()
  const state = snapshot.state as LabyrinthState | null
  if (!state || state.type !== "labyrinth") {
    return React.createElement("div", { style: { fontFamily: "monospace" } }, `${snapshot.hostname}: no map`)
  }

  const frontier = frontierCells(state.map)
  const workerRows = buildWorkerRows(state, ctx, snapshot.hostname)
  const grid = buildMapGrid(state.map, state.sessions, {
    frontier,
    claims: state.claims ?? {},
  })

  if (!grid) {
    return React.createElement(
      "div",
      { style: { fontFamily: "monospace", fontSize: "11px", marginBottom: 8 } },
      [
        renderStats(React, snapshot, state, frontier.length),
        React.createElement("div", { key: "empty" }, "No cells mapped yet -- waiting for labreport"),
        renderWorkerPanel(React, workerRows),
        renderLegend(React, workerRows),
      ],
    )
  }

  return React.createElement(
    "div",
    { style: { fontFamily: "monospace", marginBottom: 12 } },
    [
      renderStats(React, snapshot, state, frontier.length),
      React.createElement(
        "div",
        {
          key: "body",
          style: { display: "flex", flexDirection: "row", gap: 12, alignItems: "flex-start", flexWrap: "wrap" },
        },
        [renderMapGrid(React, grid, workerRows), renderWorkerPanel(React, workerRows)],
      ),
      renderLegend(React, workerRows),
    ],
  )
}

export function renderLabyrinthOverview(
  tab: { react(node: ReactNode, size?: { widthPx?: number; heightPx?: number }): void },
  labyrinths: readonly LabyrinthMapSnapshot[],
  ctx: LabyrinthOverviewContext = {},
): void {
  if (labyrinths.length === 0) return
  const sorted = [...labyrinths].sort((a, b) => a.hostname.localeCompare(b.hostname))
  for (const snap of sorted) {
    const state = snap.state as LabyrinthState | null
    const frontierList = state?.type === "labyrinth" ? frontierCells(state.map) : []
    const grid =
      state?.type === "labyrinth"
        ? buildMapGrid(state.map, state.sessions, { frontier: frontierList, claims: state.claims ?? {} })
        : null
    const workerRows =
      state?.type === "labyrinth" ? buildWorkerRows(state, ctx, snap.hostname) : []
    const mapH = grid ? grid.height * 14 + 16 : 0
    const mapW = grid ? grid.width * 13 + 16 : 0
    const heightPx = Math.max(200, mapH + 160 + workerRows.length * 14)
    const widthPx = Math.max(680, mapW + 460)
    tab.react(buildLabyrinthMapReact(snap, ctx), { widthPx, heightPx })
  }
}
