# IPvGO engine (native + WASM + KataGo)

C++ MCTS engine for Bitburner IPvGO. The server prefers **KataGo** (GPU neural net) when installed, with C++ MCTS as fallback.

## Quick start

From the **repo root**:

```bash
pnpm run ipvgo:setup   # download KataGo CUDA binary + neural nets (~200MB)
pnpm run server        # http://localhost:3010
```

In Bitburner:

```bash
run ipvgo.js
```

`ipvgo:setup` downloads:
- KataGo v1.16.5 (CUDA Windows/Linux, OpenCL fallback if CUDA zip fails)
- Main b18 net (5/7/13 boards)
- 9x9 finetuned net (9x9 only)

**First KataGo launch:** OpenCL/CUDA may GPU-autotune for several minutes (cached under `katago/KataGoData/`). The server pre-warms KataGo on startup so tuning finishes before your first in-game move.

Optional native C++ fallback:

```bash
pnpm run ipvgo:build
```

## Engine priority

1. **KataGo** (`ipvgo-engine/katago/`) — GPU analysis engine with pretrained nets
2. **Native** (`ipvgo_engine.exe`) — CPU MCTS if KataGo missing or errors

Force native only: `IPVGO_FORCE_NATIVE=1 pnpm run server`

## Prerequisites

- CMake 3.10+ (native fallback only)
- C++17 compiler (native fallback only)
- NVIDIA GPU + drivers for CUDA KataGo build (RTX series); setup falls back to OpenCL

`nlohmann/json` is fetched automatically via CMake if not installed.

## Native server

VS Code CMake uses **`ipvgo-engine/build`** only.

Server listens on **http://localhost:3010** (`IPVGO_PORT` to override).

- `GET /health` — `{ engine: "katago" | "native" | "missing", ... }`
- `POST /api/ipvgo/move` — JSON body from `ns.go`, returns `{ move, iterations, elapsedMs, engine? }`

## WASM

```bash
pnpm run build:wasm
```

Outputs `cpp/ipvgo.wasm.js` and `cpp/ipvgo.wasm.wasm`.

## Request JSON

```json
{
  "board": [".....", "..."],
  "history": [],
  "komi": 1.5,
  "iterations": 5000,
  "playAs": "X",
  "threads": 0,
  "validMoves": [[true, false, ...]]
}
```

`threads`: `0` = all CPU cores (default), or set an explicit count.

## Blocked nodes (`#`)

IPvGO boards can include blocked intersections (`#`). KataGo queries apply move restrictions from `validMoves`:

- **No blocked nodes:** `allowMoves` whitelists legal IPvGO points (+ pass) at the root.
- **With blocked nodes:** `avoidMoves` bans `#` for both players through the search tree, and bans other illegal points for the current player at the root. When `PHANTOM_ON_BLOCKED` is enabled in `katagoConvert.js`, `#` cells are sent as alternating B/W phantom stones in `initialStones` (per-cell color avoids false liberties and false chain merges through walls).

`pickMoveFromAnalysis` still filters through `validMoves` as a final safety check.

## Exploiter engine (policy expectimax)

`cpp/nn/exploiter.cpp` plays Black against a **model of the scripted opponent**
instead of an idealised one. MCGS treats White as adversarial (it assumes White
picks the best move out of the faction's candidate set); the exploiter instead
samples White from the exact policy distribution and so plays into the faction's
actual weaknesses.

- `game/opponents.cpp` → `opponentReplyDistribution()`: every faction table is
  re-expressed as "faction-rng interval → action", so branch masses are exact
  (Netburners' 20/20/20/15 split, Black Hand's surround priorities, ...) and
  pool picks are uniform, as `floorIndex()` makes them. The leading `isSmart`
  draw is mixed in with its known probability (Netburners 0, Slum Snakes 0.3,
  Black Hand 0.8, rest 1).
- `nn/exploiter.cpp`: Black maximises, White nodes average over that
  distribution. Single-candidate replies make the line **forced**, which is how
  Black builds deep "drag the AI" sequences; the beam applies only to Black and
  the leaf eval carries faction-specific liberty weights (a faction that never
  answers threats makes white groups in atari worth more, and one that captures
  at every opportunity makes black groups in atari worth less).
- Few empty points left (≤ `endgameEmpties`) switch on an endgame solve that
  plays the rest of the game out, so won games are not thrown away by the
  horizon. Captures stay captures there: invading dead white space is scored as
  the loss it is.

## Bench GUI (browser)

```bash
pnpm run server            # engine server on http://localhost:3010
# open http://localhost:3010/bench
```

The page picks factions, board size (5/7/9/13/19), think budget in ms, games per
faction and seed, then streams `ipvgo_game benchjson` events through the server:

- live board (stones, obstacles, last Black/White move rings, star points),
- per-move search numbers (depth, nodes, think ms, score),
- per-faction table with W/L, win %, average margin, ms/move and progress bar,
- recent game results and a PASS/FAIL pill when the run finishes.

Endpoints: `GET /bench`, `GET /api/bench/state`, `POST /api/bench/start`,
`POST /api/bench/stop`. Stopping the server also stops a running bench.

## CLI benchmark

```bash
# Live terminal UI: board, spinner, per-faction win table
./scripts/mcgs.sh bench 200 20 1 5

# One faction only
./scripts/mcgs.sh bench 200 20 1 5 Illuminati

# Streaming NDJSON (what the web GUI consumes); accepts a JSON string or a path
./build/Release/ipvgo_game benchjson '{"size":5,"budgetMs":200,"games":20}'

# Black vs one faction at a fixed depth, plus the policy-model check
./scripts/mcgs.sh exploitplay Netburners 5 20 2 1
./scripts/mcgs.sh policycheck "The Black Hand" 5 3000
```

`IPVGO_TUI=1` forces the terminal view, `IPVGO_TUI=0` prints one line per game,
`IPVGO_TRACE=1` prints every move.

The HTTP server also exposes the exploiter for real games with
`IPVGO_ENGINE=exploit` (POST `/api/ipvgo/move`, engine reported as `exploit`,
native MCTS as fallback). `exploitmove` accepts `depth`, `beam`,
`whiteChildren`, `whiteMass`, `endgameEmpties`, `nodeBudget`, `threads` and
`budgetMs` (iterative deepening with a wall-clock budget).
