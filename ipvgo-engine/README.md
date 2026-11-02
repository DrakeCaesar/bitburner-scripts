# IPvGO engine (exploiter + MCGS + WASM)

C++ engine for Bitburner IPvGO. Play is driven by a **policy exploiter** that
models the scripted faction AI, with Monte Carlo graph search and a legacy
heuristic MCTS engine as alternatives.

## Quick start

From the **repo root**:

```bash
pnpm run ipvgo:build   # cmake --preset release + build ipvgo_engine/ipvgo_game
pnpm run server        # http://localhost:3010
```

In Bitburner:

```bash
run ipvgo.js
```

Then open **http://localhost:3010/bench** for the benchmark GUI.

## Engine priority

The server picks the first available of:

1. **Exploit** (`ipvgo_game`) — policy expectimax against the faction AI (default)
2. **Native** (`ipvgo_engine`) — legacy heuristic MCTS, used if the exploiter is missing or errors

Overrides with `IPVGO_ENGINE`:

```bash
IPVGO_ENGINE=native   # legacy heuristic MCTS
IPVGO_ENGINE=mcgs     # Monte Carlo graph search
IPVGO_ENGINE=exploit  # force the exploiter
```

## Prerequisites

- CMake 3.18+
- C++17 compiler

`nlohmann/json` is fetched automatically via CMake if not installed.

## Native server

Native targets are built from the **repo root** into one tree, shared with the
other native components (`tests/koth_tune`):

```bash
cmake --preset release           # configure (cmake-build/)
cmake --build --preset release   # build every native target
# or just the engine:
pnpm run ipvgo:build
```

Executables land in **`cmake-build/bin/Release/`** (`ipvgo_engine`,
`ipvgo_game`, `koth_bench`, `koth_tune`). The helper scripts also accept the
older per-component `ipvgo-engine/build` layout, which still works for a
standalone `cmake -S ipvgo-engine -B ipvgo-engine/build`.

Server listens on **http://localhost:3010** (`IPVGO_PORT` to override).

- `GET /health` — `{ engine: "exploit" | "mcgs" | "native" | "missing", benchEngine, ... }`
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

`threads`: `0` = all CPU cores (default), or set an explicit count. With the
exploiter engine, `iterations` is used as a node budget (see below).

## Blocked nodes (`#`)

IPvGO boards can include blocked intersections (`#`). They are never legal
moves, so every engine simply treats them as non-playable points.

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
pnpm run server:dev    # dev server: auto-restarts on server/web changes
pnpm run server        # plain server, no restarts
```

Open **http://localhost:3010/bench**.

The page **cannot start or restart the server by itself** — a page served over
http has no process access — so the cycles it can save are handled elsewhere:

- `server:dev` (scripts/dev-server.mjs) watches `server.js`, `web/` and
  `scripts/`, restarts the server on any change, and revives it if it crashes.
- The workspace task **Server: dev (auto-restart)** runs on folder open, so the
  server is already up when you sit down.
- The GUI's **Restart server** button calls `POST /api/server/restart`, which is
  enabled only under the supervisor (it exits and the supervisor respawns).
- The page tracks the server's `serverId`; when it changes (any restart or
  rebuild) the page reloads itself, picking up new HTML/JS without a manual
  refresh. The form state and settings survive because they live in
  `localStorage`.
- if a restart never comes back (for example the server was started without the
  supervisor), the button clears itself after 8 s and says so instead of
  spinning forever. The server exits with code 75 when a restart is requested,
  which is how the supervisor tells a planned restart from a crash (crashes back
  off exponentially, planned restarts are immediate).

The page picks factions, board size (5/7/9/13/19), the thinking budget, games per
faction and seed, then streams `ipvgo_game benchjson` events through the server:

- live board (stones, obstacles, last Black/White move markers, star points),
- per-move search numbers (depth, nodes, think ms, score),
- per-faction table with W/L, win %, average margin, ms/move and progress bar,
- recent game results and a PASS/FAIL pill when the run finishes.

The thinking budget comes in two flavours, chosen with **Budget type**:

- **Time (ms)** — wall-clock per move; iterative deepening keeps the last depth
  that finished in time.
- **Iterations (nodes)** — a node budget per move (shared across search threads),
  so runs are reproducible on any machine or CPU load.

Everything on the form (factions, board size, budget type and value, games, seed)
is stored in `localStorage` and restored on reload, so a refresh keeps your setup.

**Search tuning** (collapsible panel, also persisted) exposes the exploiter knobs:

| Dial | Meaning | Default |
|---|---|---|
| Beam (our moves) | Black candidates kept per node (0 = all) | 12 |
| Replies kept | opponent replies kept per node (0 = all) | 6 |
| Reply mass cap | stop expanding replies past this probability mass | 0.9 |
| Endgame empties | empty points at which the endgame is solved exactly | 6 |
| Endgame node cap | node cap for that endgame solve | 30000 |
| Max depth | iterative-deepening ceiling | 10 |
| Threads | search threads (0 = all cores) | 0 |

Blank fields keep the engine default. Bigger beam/replies search more of the
tree and cost roughly linearly in think time.

Endpoints: `GET /bench`, `GET /api/bench/state?since=<seq>`,
`POST /api/bench/start`, `POST /api/bench/stop`. Stopping the server also stops
a running bench.

The state endpoint returns a short log of half-moves (`frames`, each with a
monotonic `seq`, whose side moved, and the resulting board). Black's move and
White's reply land milliseconds apart, far faster than any polling loop, so the
server **pushes** them instead:

- `GET /api/bench/events` is a Server-Sent Events stream: a `snapshot` on
  connect, then `game`, `thinking`, `frame`, `rows`, `result`, `done` as they
  happen. Polling is only a fallback if the stream cannot be opened.
- the page plays the queued frames one per ~80 ms (25 ms while catching up), so
  both sides are visible; it repaints only the parts that changed, once per
  animation frame.

Verify the whole path with the bundled client:

```bash
node ipvgo-engine/tools/check-bench-stream.mjs 3010 4000
# connected: 200 text/event-stream
# events received: snapshot=2 rows=3 game=1 thinking=7 frame=13 result=1 done=1
# frames=13 ... avgGap=113.2ms alternations=12
```

Helper tools:

| Tool | Purpose |
|---|---|
| `tools/check-bench-stream.mjs <port> <ms>` | drives the SSE stream like the page and reports event counts, frame gaps, and every distinct `serverId` |
| `tools/check-encoding.mjs <files...>` | flags non-ASCII (and mojibake) in text files |
| `tools/fix-encoding.mjs <files...>` | repairs double-encoded text |

## CLI benchmark

```bash
# Live terminal UI: board, spinner, per-faction win table
./scripts/mcgs.sh bench 200 20 1 5

# Node budget instead of milliseconds ("i" suffix)
./scripts/mcgs.sh bench 20000i 20 1 5

# Search tuning as --key=value flags (same knobs as the GUI panel)
./scripts/mcgs.sh bench 20000i 20 1 5 --beam=20 --white-children=4 --white-mass=0.8 \
  --endgame-empties=10 --node-budget=90000 --max-depth=14 --threads=4 Netburners

# One faction only
./scripts/mcgs.sh bench 200 20 1 5 Illuminati

# Streaming NDJSON (what the web GUI consumes); accepts a JSON string or a path.
# Use either "budgetMs" or "iterations" (nodes), not both.
./build/Release/ipvgo_game benchjson '{"size":5,"budgetMs":200,"games":20}'
./build/Release/ipvgo_game benchjson '{"size":5,"iterations":50000,"games":20}'

# Black vs one faction at a fixed depth, plus the policy-model check
./scripts/mcgs.sh exploitplay Netburners 5 20 2 1
./scripts/mcgs.sh policycheck "The Black Hand" 5 3000

# A/B the search optimisations (baseline, each flag, all together) on one
# position set, sized to ~20 s; prints per-search lines live and a summary.
./scripts/mcgs.sh optbench
./scripts/mcgs.sh optbench --seconds=40 --positions=6 --depth=3
./scripts/mcgs.sh optbench --only=baseline,fastQueries,all
```

`IPVGO_TUI=1` forces the terminal view, `IPVGO_TUI=0` prints one line per game,
`IPVGO_TRACE=1` prints every move.

## Profiling

The Visual Studio / ETW CPU profiler needs an elevated session. `ipvgo_prof` is
an unprivileged in-process alternative: it counts allocations (attributed to the
calling function) and samples every thread's stack with `StackWalk64`.

```bash
# Configure with the profiler enabled (off by default: it rebuilds the engine
# with /Zi for symbols and runs it in a second executable)
cmake --preset release -DIPVGO_BUILD_PROFILER=ON
cmake --build --preset release --target ipvgo_prof

# ipvgo_prof <faction> <depth> <ply> <reps>
./cmake-build/bin/Release/ipvgo_prof "Slum Snakes" 3 6 3
```

It prints the allocations/bytes per search with the top allocation sites, then
exclusive/inclusive sample shares per function and the hottest caller->callee
edges.

For the real ETW profiler, from an elevated prompt:

```powershell
xperf -on PROC_THREAD+LOADER+PROFILE -stackwalk PROFILE
ipvgo_game.exe optbench --only=all --positions=2
xperf -d trace.etl
xperf -i trace.etl -o trace.csv -a dumper   # then pivot the Stack column
```

## Performance baseline

Reference point for optimisation work: **`c2bbf26`** (flat board, packed superko
history, bitwise captures). Measure against these numbers, not against older
commits.

Reproduce, from a Release build:

```bash
# Allocation count + time for one fixed search (deterministic node count)
./cmake-build/bin/Release/ipvgo_prof "Slum Snakes" 3 6 1

# Fixed-depth search cost; threads=1 keeps it deterministic
./cmake-build/bin/Release/ipvgo_game optbench --only=all --positions=2 --depth=3 --threads=1 --reps=3
```

| measurement | baseline @ `c2bbf26` |
|---|---|
| `ipvgo_prof` search (36 290 nodes) | ~370-410 ms, 3 313 269 allocations, 166 MB |
| `optbench` per search (2 positions, depth 3) | ~2.4 s (wall clock is noisy; the node counts are the stable part), 68 678 nodes |
| `optbench` position 1 / 2 | 40 847 nodes, value 0.2245 / 27 831 nodes, value 0.0309 |

Largest remaining allocation sites: `_Hash_vec::_Assign_grow` (340k / 48 MB,
`unordered_set` buckets in the policy path), `vector<int>::reserve` (359k,
`computeChains` per-call reservations), `BoardHistory::append` (39k),
`GameState` copies (47k).

### Parity checks

Any change to the rules or the board representation must keep these identical,
not merely similar:

```bash
./cmake-build/bin/Release/ipvgo_game selftest          # includes bitwise-capture vs flood-fill oracle
./cmake-build/bin/Release/ipvgo_game fuzz 60 11        # expect 6874 moves, 0 anomalies
./cmake-build/bin/Release/ipvgo_game policycheck "The Black Hand" 5 800
# per-move trace, including values and node counts:
IPVGO_TRACE=1 ./cmake-build/bin/Release/ipvgo_game exploitplay "Slum Snakes" 5 2 2 1
```

`optbench` node counts are deterministic at `--threads=1`; at the default thread
count they vary run to run, so compare values rather than node counts.

The HTTP server also exposes the exploiter for real games with
`IPVGO_ENGINE=exploit` (POST `/api/ipvgo/move`, engine reported as `exploit`,
native MCTS as fallback). `exploitmove` accepts `depth`, `beam`,
`whiteChildren`, `whiteMass`, `endgameEmpties`, `nodeBudget`, `threads`,
`budgetMs` (wall-clock iterative deepening) and `iterations`/`nodeLimit` (node
budget; the in-game client's `iterations` field is used as the node budget).
