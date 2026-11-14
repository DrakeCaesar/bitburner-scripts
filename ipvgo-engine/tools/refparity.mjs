#!/usr/bin/env node
// Generates a parity corpus from the reference 5x5 playout script and writes it as JSON for the
// engine's `refparity` command to check against its own implementation.
//
// The point is to compare the deterministic parts of the engine case by case. The search itself is
// stochastic - both sides draw random numbers from different generators - so a move-for-move
// comparison is meaningless. Everything the search is *built* from is deterministic, though, and
// that is what is compared here:
//
//   * liberty counts per point
//   * the influence map (territory control)
//   * the terminal score, in both of its modes
//   * White's eye count
//   * the children of a node and their opponent-model weights
//
// The weights are the most valuable of these. They encode the opponent model, which is most of the
// engine's strength, and a single flipped condition there changes every playout while looking like
// noise in a win rate.
//
// Usage:
//   node refparity.mjs <reference.js> <out.json> [cases]
//
// The reference is loaded by copying it next to a temp module with the internal functions
// exported; it is never modified in place.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [refPath, outPath, caseCountArg] = process.argv.slice(2);
if (!refPath || !outPath) {
  console.error("usage: node refparity.mjs <reference.js> <out.json> [cases]");
  console.error("       node refparity.mjs <reference.js> debug <rows> <black|white>");
  process.exit(2);
}
const debugMode = outPath === "debug";
const caseCount = Number(caseCountArg || 400);

// The reference is an ES module whose internals are module-scope. Copying it with an export list
// appended is the least invasive way to reach them: the file itself is untouched, and nothing in
// the copy edits a line of it.
const source = fs.readFileSync(refPath, "utf8");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refparity-"));
const tempModule = path.join(tempDir, "reference.mjs");

// Debug mode instruments the *copy* to dump the flags behind each weight. The original file is
// never touched; the copy lives in a temp directory and is deleted at the end.
const debugRows = debugMode ? process.argv[4] : null;
const debugSide = debugMode ? process.argv[5] : null;
let instrumented = source;
if (debugMode) {
  // Two injections: the flags are only in scope inside the opponent-model block, and the final
  // weight is only in scope at the edge push. Both are merged by point.
  const flagMarker = "            let makesEye = false;";
  const pushMarker = "        this.children.push(new MCGSEdge(hash, nb, x * BOARD_SIZE + y, weight));";
  for (const marker of [flagMarker, pushMarker]) {
    if (!instrumented.includes(marker)) {
      console.error(`debug: could not find the line to instrument: ${marker.trim()}`);
      process.exit(2);
    }
  }
  instrumented = instrumented.replace(
    flagMarker,
    `            if (globalThis.__refDebug !== undefined) ((globalThis.__refDebug[5 * x + y] ??= {}).flags = {x, y,
              iscapture, isdefend, isnobi, isatari, bigatari, hasneighbor, emptycount,
              neighborliberties, white_or_offline_neighbors, issurround});
` + flagMarker,
  );
  instrumented = instrumented.replace(
    pushMarker,
    `        if (globalThis.__refDebug !== undefined) ((globalThis.__refDebug[5 * x + y] ??= {}).weight = weight);
` + pushMarker,
  );
}

fs.writeFileSync(
  tempModule,
  instrumented +
    "\nexport { linearizeBoard, getLibertiesLinear, addMoveLinear, getTerritory," +
    " scoreTerminalLinear, countWhiteEyesLinear, MCGSNode };\n",
  "utf8",
);

const ref = await import(pathToFileURL(tempModule).href);

if (debugMode) {
  const linear = new Int8Array(25);
  const rows = debugRows.split(",");
  for (let x = 0; x < 5; ++x) {
    for (let y = 0; y < 5; ++y) {
      // `rows` is indexed by y (one string per printed row), the board by x - the same convention
      // the engine prints with, so a failing case can be pasted in directly.
      const ch = rows[y][x];
      linear[5 * x + y] = ch === "#" ? -1 : ch === "." ? 0 : ch === "X" ? 1 : 2;
    }
  }
  globalThis.__refDebug = [];
  new ref.MCGSNode(linear, debugSide !== "white", new Map(), new Set());
  const libs = new Int8Array(25);
  ref.getLibertiesLinear(linear, libs);
  const terr = ref.getTerritory(linear);
  console.log(`board (white to play = ${debugSide === "white"})`);
  for (let i = 0; i < 25; ++i) {
    const entry = globalThis.__refDebug[i];
    if (!entry) continue;
    const f = entry.flags ?? {};
    console.log(
      `pos ${String(i).padStart(2)} (x=${i / 5 | 0},y=${i % 5}) weight=${entry.weight}` +
        ` libs=${libs[i]} terr=${terr[i]}` +
        ` capture=${f.iscapture} defend=${f.isdefend} nobi=${f.isnobi} atari=${f.isatari}` +
        ` bigatari=${f.bigatari} surround=${f.issurround} hasNeighbour=${f.hasneighbor}` +
        ` empty=${f.emptycount} nbLibs=${f.neighborliberties} wOff=${f.white_or_offline_neighbors}`,
    );
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}

// A small deterministic generator, so a corpus can be regenerated exactly.
let seed = 0x2f6e2b1n;
function random() {
  seed ^= seed << 13n;
  seed ^= seed >> 7n;
  seed ^= seed << 17n;
  seed &= 0xffffffffffffffffn;
  return Number(seed >> 32n) / 0x100000000;
}
function pick(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (let i = 0; i < weights.length; ++i) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

// A board worth testing has stones of both colours, some offline points and some space left. Pure
// noise mostly produces positions that no game reaches, so the generator is biased towards the
// shapes games actually make: stones next to each other, small enclosed spaces, and at least a
// couple of empty points for the influence map to have something to decide.
function randomBoard() {
  const board = new Array(25).fill(0);
  const offlineChance = [0, 0, 0.08, 0.12, 0.18][pick([3, 4, 3, 2, 1])];
  for (let i = 0; i < 25; ++i) {
    if (random() < offlineChance) board[i] = -1;
  }
  const stones = 1 + pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (let s = 0; s < stones; ++s) {
    const i = pick(new Array(25).fill(1));
    if (board[i] !== 0) continue;
    // Prefer a colour that already has stones, which is what makes chains.
    const black = board.filter((v) => v === 1).length;
    const white = board.filter((v) => v === 2).length;
    board[i] = black <= white ? 1 : 2;
  }
  return board;
}

function boardToStrings(linear) {
  const rows = [];
  for (let x = 0; x < 5; ++x) {
    let row = "";
    for (let y = 0; y < 5; ++y) {
      const v = linear[5 * x + y];
      row += v === -1 ? "#" : v === 0 ? "." : v === 1 ? "X" : "O";
    }
    rows.push(row);
  }
  return rows;
}

const cases = [];
const seen = new Set();

function addCase(linear, blackToPlay) {
  const key = linear.join(",") + (blackToPlay ? "b" : "w");
  if (seen.has(key)) return;
  seen.add(key);

  const rows = boardToStrings(linear);
  const flat = new Int8Array(ref.linearizeBoard(rows));

  const liberties = new Int8Array(25);
  ref.getLibertiesLinear(flat, liberties);
  const territory = ref.getTerritory(flat);

  // The node constructor is what builds the children and their weights. It runs one playout for the
  // node's own value, which the comparison ignores - only the move list and the weights matter.
  let children = [];
  try {
    const node = new ref.MCGSNode(flat, blackToPlay, new Map(), new Set());
    children = node.children.map((c) => [c.pos, c.weight]);
  } catch {
    return; // the reference can throw on a position it never expects; not a parity failure
  }

  cases.push({
    board: Array.from(linear),
    blackToPlay,
    liberties: Array.from(liberties),
    territory: Array.from(territory),
    scoreInfluence: ref.scoreTerminalLinear(flat, false),
    scoreImmediate: ref.scoreTerminalLinear(flat, true),
    whiteEyes: ref.countWhiteEyesLinear(flat),
    children,
  });
}

// A few shapes worth naming, so a failure points at something recognisable.
const named = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // empty
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // lone black stone
  [2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // two white stones
  [2, 2, 2, 0, 0, 2, 0, 2, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // white eye
  [1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // black eye
  [-1, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // offline corner
];
for (const shape of named) {
  addCase(shape, true);
  addCase(shape, false);
}

for (let i = 0; i < caseCount * 2; ++i) {
  const board = randomBoard();
  addCase(board, i % 2 === 0);
}

fs.writeFileSync(outPath, JSON.stringify({ cases }), "utf8");
fs.rmSync(tempDir, { recursive: true, force: true });
console.log(`refparity: wrote ${cases.length} cases to ${outPath}`);
