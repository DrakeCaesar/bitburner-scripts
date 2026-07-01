import { type ReactNode } from "@ns"
import { getReact } from "@/libraries/scriptLogUi.js"
import { buildMapGrid, type LabyrinthState, type MapGridChar } from "../solvers/labyrinth.js"
import type { LabyrinthMapSnapshot } from "../types.js"

const BLOCK = "\u2588"
const OPEN = " "
const WORKER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function cellChar(kind: MapGridChar, letter?: string): string {
  if (kind === "worker") return letter ?? "*"
  if (kind === "wall") return BLOCK
  if (kind === "open") return OPEN
  return BLOCK
}

function cellOpacity(kind: MapGridChar): number {
  if (kind === "unknown") return 0.25
  return 1
}

function workerLegend(state: LabyrinthState): string[] {
  const workers = Object.keys(state.sessions).sort()
  const lines: string[] = []
  for (let i = 0; i < workers.length; i++) {
    const host = workers[i]!
    const sess = state.sessions[host]
    const letter = WORKER_LETTERS[i] ?? String(i + 1)
    const pos = sess?.coords ? `@ ${sess.coords.join(",")}` : ""
    const phase = sess && sess.phase !== "done" ? ` (${sess.phase})` : ""
    lines.push(`${letter} ${host}${pos}${phase}`)
  }
  return lines
}

function buildLabyrinthMapReact(snapshot: LabyrinthMapSnapshot): ReactNode {
  const React = getReact()
  const state = snapshot.state as LabyrinthState | null
  if (!state || state.type !== "labyrinth") {
    return React.createElement("div", { style: { fontFamily: "monospace" } }, `${snapshot.hostname}: no map`)
  }

  const grid = buildMapGrid(state.map, state.sessions)
  if (!grid) {
    return React.createElement(
      "div",
      { style: { fontFamily: "monospace", marginBottom: 4 } },
      `${snapshot.hostname}: no cells mapped yet`,
    )
  }

  const workers = Object.keys(state.sessions).sort()
  const workerAt = new Map<string, string>()
  for (let i = 0; i < workers.length; i++) {
    const host = workers[i]!
    const sess = state.sessions[host]
    if (!sess?.coords) continue
    const key = `${sess.coords[0]},${sess.coords[1]}`
    const letter = WORKER_LETTERS[i] ?? String(i + 1)
    workerAt.set(key, workerAt.has(key) ? "*" : letter)
  }

  const seenCount = Object.values(state.map).filter((c) => c.seen).length
  const header = `${snapshot.hostname}  status ${snapshot.status}  explored ${seenCount} cell(s)  ${workers.length} explorer(s)`
  const pending =
    snapshot.pendingCommand != null
      ? `pending ${snapshot.pendingCommand} via ${snapshot.pendingWorker ?? "?"}`
      : null

  const rows = grid.cells.map((row, gy) =>
    React.createElement(
      "div",
      { key: `r-${gy}`, style: { display: "flex", flexDirection: "row", lineHeight: 1 } },
      row.map((kind, gx) => {
        let displayKind = kind
        let letter: string | undefined
        if (kind === "worker" || kind === "open") {
          const logicalX = grid.minX + (gx / 2) * 2
          const logicalY = grid.minY + (gy / 2) * 2
          if (gx % 2 === 0 && gy % 2 === 0) {
            const mk = `${logicalX},${logicalY}`
            const w = workerAt.get(mk)
            if (w) {
              displayKind = "worker"
              letter = w
            } else if (kind === "worker") {
              displayKind = "open"
            }
          }
        }
        return React.createElement(
          "span",
          {
            key: `c-${gx}-${gy}`,
            style: {
              fontFamily: "monospace",
              opacity: cellOpacity(displayKind),
              width: "1ch",
              display: "inline-block",
              textAlign: "center",
            },
          },
          cellChar(displayKind, letter),
        )
      }),
    ),
  )

  const legend = workerLegend(state)
  const children = [
    React.createElement("div", { key: "hdr", style: { marginBottom: 2 } }, header),
    React.createElement(
      "div",
      { key: "key", style: { marginBottom: 4, opacity: 0.85 } },
      `Legend: ${BLOCK} wall  ${OPEN} corridor  faded ${BLOCK} unknown  A-Z worker  * multiple`,
    ),
    pending
      ? React.createElement("div", { key: "pend", style: { marginBottom: 4 } }, pending)
      : null,
    React.createElement("div", { key: "map", style: { display: "inline-block", marginBottom: 4 } }, rows),
    legend.length > 0
      ? React.createElement("div", { key: "workers", style: { marginTop: 4 } }, `Workers: ${legend.join("  |  ")}`)
      : null,
  ].filter(Boolean)

  return React.createElement("div", { style: { fontFamily: "monospace", marginBottom: 8 } }, children)
}

export function renderLabyrinthOverview(
  tab: { react(node: ReactNode, size?: { widthPx?: number; heightPx?: number }): void },
  labyrinths: readonly LabyrinthMapSnapshot[],
): void {
  if (labyrinths.length === 0) return
  const sorted = [...labyrinths].sort((a, b) => a.hostname.localeCompare(b.hostname))
  for (const snap of sorted) {
    const state = snap.state as LabyrinthState | null
    const grid = state?.type === "labyrinth" ? buildMapGrid(state.map, state.sessions) : null
    const heightPx = grid ? Math.max(120, grid.height * 14 + 80) : 48
    const widthPx = grid ? Math.max(200, grid.width * 10 + 24) : 240
    tab.react(buildLabyrinthMapReact(snap), { widthPx, heightPx })
  }
}
