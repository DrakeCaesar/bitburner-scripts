/**
 * Renders one archived bench game as a plain-ASCII explanation.
 *
 * The shape the loss analysis reads: one line per Black move with the value the
 * search gave it and the drop the following move showed, then a block per blunder
 * with the boards, what the leaf evaluator said at each step, what the search
 * preferred instead, and how likely White's actual reply was. Plain ASCII on
 * purpose: the text is meant to be diffed and grepped, and the repo's UI rules
 * forbid decorative glyphs.
 */

import fs from "fs"
import path from "path"

// Go coordinates skip I, matching the page's board labels.
const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"
// A blunder is the value attached to Black's move minus the value of the next one:
// the drop White's actual reply caused.
export const BLUNDER_DELTA = 0.15
// Above this the logistic has saturated: every root move reads (nearly) 1.000, so
// the number is a cap rather than a probability.
const CAPPED_VALUE = 0.999

function num(value, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-"
}

function pad(text, width, leftAlign = true) {
  const value = String(text ?? "-")
  if (value.length >= width) return value
  const fill = " ".repeat(width - value.length)
  return leftAlign ? value + fill : fill + value
}

function point(mv, key) {
  if (mv?.[`${key}Pass`]) return "pass"
  const at = mv?.[key]
  if (!at) return "-"
  return `${at.x},${at.y}`
}

function evalLine(label, report) {
  if (!report) return `${label} (no audit data)`
  return (
    `${label} lead ${num(report.lead, 1)}  p(win) ${num(report.win, 3)}  ` +
    `empties ${report.empties ?? "-"}  rules lead ${num(report.rulesLead, 1)}`
  )
}

function asciiBoard(board) {  if (!board || board.length === 0) return ["(no board)"]
  const n = board.length
  const rows = ["      " + Array.from({ length: n }, (_, x) => COLUMN_LETTERS[x] ?? "?").join(" ")]
  for (let y = n - 1; y >= 0; y--) {
    const cells = Array.from({ length: n }, (_, x) => {
      const cell = board[x]?.[y]
      return cell === "X" || cell === "O" || cell === "#" ? cell : "."
    })
    rows.push(`  ${String(y + 1).padStart(2, " ")}  ${cells.join(" ")}`)
  }
  return rows
}

// The drop between one move's value and the next one's. `null` when either end is
// unknown, so a missing audit field never reads as a blunder.
function valueDrops(moves) {
  return moves.map((mv, i) =>
    typeof mv.value === "number" && typeof moves[i + 1]?.value === "number" ? mv.value - moves[i + 1].value : null
  )
}

// The same drop on the depth-independent series (a fixed one-ply search), which is
// the one that means "the position got worse". The search value moves whenever the
// node budget happens to buy a deeper look, so a drop in it is not by itself a
// blunder: in the 240-game in-game-budget capture, 119 drops above 0.15 split
// between the leaf flipping and the budget changing depth, and only the flat
// series separates them.
function flatDrops(moves) {
  return moves.map((mv, i) => {
    const a = mv.audit?.flat
    const b = moves[i + 1]?.audit?.flat
    return typeof a === "number" && typeof b === "number" ? a - b : null
  })
}

export function explainGame(game, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : BLUNDER_DELTA
  const moves = game.moves ?? []
  const size = moves[0]?.board?.length ?? 0
  const margin = typeof game.margin === "number" ? game.margin : 0
  const drops = valueDrops(moves)
  const swings = flatDrops(moves)
  const blunders = drops
    .map((drop, i) => ({ drop, i }))
    .filter((entry) => entry.drop !== null && entry.drop > threshold)
  const capped = moves.filter((mv) => typeof mv.value === "number" && mv.value >= CAPPED_VALUE).length
  const lines = []

  lines.push(
    `${game.faction} #${game.game} - ${game.win ? "WIN " : "LOSS"} ${margin >= 0 ? "+" : ""}${margin.toFixed(1)} ` +
      `after ${moves.length} Black moves${size ? ` (${size}x${size})` : ""}`
  )
  lines.push("")
  lines.push("  Black = policy expectimax, White = scripted faction.")
  lines.push("  p(win)  value the search attached to Black's move, averaged over the White replies it modelled.")
  lines.push("  delta   p(win) of this move minus the next one: the drop White's actual reply caused.")
  lines.push("  flat    the same value from a fixed one-ply search. The search value depends on how deep")
  lines.push("          the node budget got, so delta mixes a real change with a change of depth; swing")
  lines.push("          is the drop on the flat series, which only moves when the position does.")
  lines.push("  evalW   the leaf evaluator's p(win) after White's reply; rules is getScore's lead (Black - White).")
  lines.push("  mdl p   probability the reply model gave White's actual move (blank without audit data).")
  lines.push("  flag    BLUNDER = the search value dropped, SWING = the position itself dropped,")
  lines.push("          CAPPED = the value is pinned at 1.000, which is a heuristic cap, not certainty.")
  lines.push("")
  lines.push(
    `  drops: ${blunders.length} above ${threshold.toFixed(2)}   saturated rows: ${capped}   ` +
      `real swings: ${swings.filter((s) => s !== null && s > threshold).length}`
  )
  lines.push("")

  const head =
    pad("#", 3, false) +
    "  " +
    pad("Black", 6) +
    pad("p(win)", 7, false) +
    pad("delta", 7, false) +
    pad("flat", 7, false) +
    pad("swing", 7, false) +
    "  " +
    pad("d/nodes/ms", 18) +
    pad("White", 7) +
    pad("B:W", 10, false) +
    pad("evalW", 7, false) +
    pad("rules", 7, false) +
    pad("mdl p", 7, false) +
    "  flag"
  lines.push(head)
  lines.push("  " + "-".repeat(head.length - 2))

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]
    const drop = drops[i]
    const swing = swings[i]
    const afterWhite = mv.whiteAudit?.after ?? mv.audit?.after ?? null
    const flags = []
    if (drop !== null && drop > threshold) flags.push("BLUNDER")
    if (swing !== null && swing > threshold) flags.push("SWING")
    if (typeof mv.value === "number" && mv.value >= CAPPED_VALUE) flags.push("CAPPED")
    lines.push(
      pad(mv.move ?? i + 1, 3, false) +
        "  " +
        pad(point(mv, "black"), 6) +
        pad(num(mv.value, 3), 7, false) +
        pad(typeof drop === "number" ? num(drop, 3) : "", 7, false) +
        pad(num(mv.audit?.flat, 3), 7, false) +
        pad(typeof swing === "number" ? num(swing, 3) : "", 7, false) +
        "  " +
        pad(`${mv.depth ?? "-"}/${mv.nodes ?? "-"}/${mv.ms == null ? "-" : Math.round(mv.ms)}`, 18) +
        pad(point(mv, "white"), 7) +
        pad(`${Math.round(mv.blackScore ?? 0)}:${Math.round(mv.whiteScore ?? 0)}`, 10, false) +
        pad(num(afterWhite?.win, 3), 7, false) +
        pad(num(afterWhite?.rulesLead, 1), 7, false) +
        pad(mv.whiteAudit?.model?.found ? num(mv.whiteAudit.model.prob, 2) : "", 7, false) +
        "  " +
        flags.join(" ")
    )
  }

  // Per blunder: the position it was played from, what the eval said at each step,
  // what the search preferred, and how the reply that broke it was priced.
  for (const { drop, i } of blunders) {
    const mv = moves[i]
    const next = moves[i + 1]
    lines.push("")
    lines.push(
      `BLUNDER at move ${mv.move ?? i + 1}: p(win) ${num(mv.value, 3)} -> ${num(next?.value, 3)} ` +
        `(drop ${num(drop, 3)})`
    )
    lines.push("  Black played " + point(mv, "black") + ", White played " + point(mv, "white"))
    lines.push("  " + evalLine("root       ", mv.audit?.root))
    lines.push("  " + evalLine("after Black", mv.audit?.after))
    lines.push("  " + evalLine("after White", mv.whiteAudit?.after))
    const swing = swings[i]
    lines.push(
      `  depth ${mv.depth ?? "-"} -> ${next?.depth ?? "-"}   next search ${num(next?.value, 3)}   ` +
        `flat ${num(mv.audit?.flat, 3)} -> ${num(next?.audit?.flat, 3)}`
    )
    if (swing !== null && swing > threshold) {
      lines.push(`  verdict: a real swing - the fixed-depth value fell ${num(swing, 3)} too.`)
    } else if (swing !== null) {
      lines.push(
        `  verdict: the fixed-depth value moved only ${num(swing, 3)}, so most of this drop is the depth the ` +
          `next search reached (${mv.depth ?? "-"} -> ${next?.depth ?? "-"}), not a worse position.`
      )
    }
    const model = mv.whiteAudit?.model
    const replies = mv.audit?.replies ?? []
    if (model || replies.length > 0) {
      const top = replies
        .map((reply) => `${reply.pass ? "pass" : `${reply.x},${reply.y}`} ${num(reply.prob, 2)}`)
        .join(" | ")
      lines.push(
        `  White's reply was modelled at ${model?.found ? num(model.prob, 3) : "not in the set"}` +
          ` (${model?.points ?? replies.length} points${top ? `; top: ${top}` : ""})`
      )
    }
    const alternatives = (mv.audit?.top ?? []).slice(0, 3)
    if (alternatives.length > 0) {
      const played = (alt) =>
        alt.pass ? !!mv.blackPass : !mv.blackPass && alt.x === mv.black?.x && alt.y === mv.black?.y
      const ranked = alternatives
        .map((alt) => `${alt.pass ? "pass" : `${alt.x},${alt.y}`} ${num(alt.value, 3)}${played(alt) ? "*" : ""}`)
        .join("  ")
      lines.push(`  search alternatives: ${ranked}   (* = played)`)
    }
    lines.push("  before Black's move:")
    for (const row of asciiBoard(mv.board)) lines.push("    " + row)
  }

  if (blunders.length === 0) {
    lines.push("")
    lines.push(`No drop above ${threshold.toFixed(2)}: this game lost without a single visible swing.`)
  }
  const last = moves[moves.length - 1]
  const finalBoard = last?.boardAfterWhite ?? last?.board
  if (finalBoard) {
    lines.push("")
    lines.push("final position:")
    for (const row of asciiBoard(finalBoard)) lines.push("  " + row)
  }
  lines.push("")
  return lines.join("\n")
}

// Write one game's explanation under `dir` and return where it went.
export function writeExplainFile(game, text, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const slug = String(game.faction ?? "game")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")
  const file = path.join(dir, `${slug}-${game.game}-${stamp}.txt`)
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n")
  return file
}
