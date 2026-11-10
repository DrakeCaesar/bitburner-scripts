# IPvGO engine (exploiter + MCGS)

C++ engine for Bitburner IPvGO. Play is driven by a **policy exploiter** that
models the scripted faction AI, with Monte Carlo graph search and a legacy
heuristic MCTS engine as alternatives.

## Quick start

From the **repo root**:

```bash
pnpm run ipvgo:build   # Build-Native.ps1: configure + build ipvgo_engine/ipvgo_game
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
./cmake/Build-Native.ps1 -Configure              # configure + build everything (Release)
./cmake/Build-Native.ps1 -Target ipvgo_game      # one target, after configuring
# or just the engine, through the package script:
pnpm run ipvgo:build
```

Ninja invokes `cl.exe` directly, so it needs the variables the Visual Studio
developer environment sets up (`INCLUDE`, `LIB`, `PATH`); without them a compile
fails with `C1083: Cannot open include file: 'array'`. `Build-Native.ps1` finds
Visual Studio with `vswhere`, imports that environment, and then runs CMake, so
it works from any shell. Running bare `cmake --build ...` only works inside a
*Developer PowerShell for VS*.

Executables land in **`out/build/x64-Release/bin/`** (`ipvgo_engine`,
`ipvgo_game`, `koth_bench`, `koth_tune`). The helper scripts also accept the
older per-component `ipvgo-engine/build` layout, which still works for a
standalone `cmake -S ipvgo-engine -B ipvgo-engine/build`.

`CMakeSettings.json` defines the same tree for the IDE: `x64-Release` for
performance work, `x64-Profile` (`RelWithDebInfo`) for profiling, plus
`x64-Debug`, the two `x64-Clang-*` configurations and `Linux-*`. Each
configuration builds into `out/build/<name>`.

`CMakePresets.json` (repo root, tracked) declares the *generator* for every entry
point: `x64-Release`, `x64-Debug`, `x64-Profile` and the two `x64-Pgo-*` passes, all
Ninja and all pointing at the same `out/build/<name>` directories that
`CMakeSettings.json` and `Build-Native.ps1` use. Use it directly when the MSVC
environment is already loaded:

```powershell
cmake --preset x64-Release        # configure
cmake --build --preset x64-Release
```

A build tree is bound to the generator that created it, so every entry point has to
agree on one. CMake Tools gets its generator from the preset (enable presets in the
editor; the `.vscode/` folder is gitignored, so nothing there can protect another
checkout), and `Build-Native.ps1` configures through the same preset. Configure the
same folder with two generators and CMake aborts with `generator ... does not match
the generator used previously`, and the recovery - deleting the tree, which
`Build-Native.ps1 -Configure` does automatically - throws away the whole build
directory. If a toolchain change makes a tree unusable, prefer deleting
`out/build/<name>` yourself over letting two generators fight over it.

The profiling build keeps inlining off by default (`x64-Profile`). For profile
numbers that match Release, override the cache variable on either entry point:
`cmake --preset x64-Profile -DIPVGO_PROFILE_INLINING=ON`, or
`Build-Native.ps1 -BuildType RelWithDebInfo -ProfileInlining`. It is the same tree
either way - the flag only changes what the compile step does.

Server listens on **http://localhost:3010** (`IPVGO_PORT` to override).

- `GET /health` — `{ engine: "exploit" | "mcgs" | "native" | "missing", benchEngine, ... }`
- `POST /api/ipvgo/move` — JSON body from `ns.go`, returns `{ move, iterations, elapsedMs, engine? }`

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
- The objective is the **probability that Black wins**, not the score. A finished
  game is worth exactly 1 or 0 - winning by one point counts as much as winning
  by fifty - and every leaf is `logistic(lead / (3.4 + 1.45*sqrt(empties)))`, so
  a lead is worth what it is actually worth: almost nothing with the board open,
  nearly everything with two points left. The constants are a maximum-likelihood
  fit on 2,577 positions, and the atari weights above are expressed in points
  (0.6 points of lead per unit) so a weight means the same thing on every board
  size. Measured against the old margin objective at the in-game budget on 5x5,
  180 games per arm on two unseen seeds: 139 wins for margin, 148 for win
  probability. On one of those seeds the average margin fell (5.74 -> 2.39) while
  wins rose, which is what trading points for wins looks like.
- Few empty points left (≤ `endgameEmpties`) switch on an endgame solve that
  plays the rest of the game out, so won games are not thrown away by the
  horizon. Captures stay captures there: invading dead white space is scored as
  the loss it is.
- Under a node budget the search trades **width for depth** when White's policy
  allows it. A per-ply branching factor `b` costs about `r * b^depth` nodes, so
  with `r` root moves it sets `b = (budget / r)^(1/depth)` and splits that between
  the Black beam and White's reply count, only ever narrowing. The result is that
  a 100k budget reaches depth 10 in 2.9k nodes instead of depth 4 in 69k.

  Narrowing White's replies is only sound when White is **effectively forced**:
  then one line is the real continuation. When White picks from a wide pool, a
  single line is one of many equally likely moves and the deep search chases a
  fiction. So the trade is enabled only when, in every one of six spread-out
  positions Black could reach, a single White reply covers 90% of the mass. It has
  to be measured in the positions White replies *from* - at the root, even
  Netburners looks concentrated. 7x7, 20k budget, 60 games per faction:

  | | Netburners | SlumSnakes | BlackHand | Tetrads | Daedalus | Illuminati |
  |---|---|---|---|---|---|---|
  | fixed width | 53 | 51 | 59 | 46 | 45 | 19 |
  | adaptive | 55 | 48 | 56 | 49 | 48 | 38 |

  273 -> 294 wins of 360. The gain is not board-specific: 5x5 goes 99 -> 108 of 120
  and 9x9 84 -> 101 of 120 on the same 20-game-per-faction comparison.
  `IPVGO_FIXED_WIDTH=1` restores the fixed width, and
  `IPVGO_CONCENTRATED_REPLIES=3` loosens the test: that reaches +34 on Illuminati
  and +13 on Daedalus but costs SlumSnakes 13 games, so the strict test ships.

## Bench GUI (browser)

```bash
pnpm run server:dev    # dev server: auto-restarts on server/web changes
pnpm run server        # plain server, no restarts
```

Open **http://localhost:3010/bench**.

The page **cannot start or restart the server by itself** — a page served over
http has no process access — so the cycles it can save are handled elsewhere:

- `server:dev` (scripts/dev-server.mjs) watches `server.js`, `lib/`, `web/` and
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

### Expanding a past game

Every game of the current batch is archived with its full move list, so the
decision sequence behind a result can be inspected instead of just its win/loss.
Under **Games**, click a game to open it: one row per Black move with the move it
played, the win probability it assigned, the fixed-depth value (see below), the
search depth and node count, the wall time, White's actual reply, and the score
after the half-move. Clicking a row shows that position on the board above, which
is how "why did it play there" gets answered without re-running anything. Hovering
a row shows the leaf evaluator's own numbers for it.

Two switches sit above the list:

- **only losses** filters the list to the games Black lost, and reports how many
  of the archive are shown ("12 of 20 shown"). The faction table above stays
  complete; only the list is filtered, and expanded rows stay expanded.
- **write loss files** writes an explanation for every loss as the run goes, to
  `ipvgo-engine/temp/lost-games/<faction>-<game>-<timestamp>.txt`. Off by default,
  so a long batch does not leave hundreds of files nobody opens.

Both are remembered across reloads, separately from the run form.

#### Locking losses to tune against them

**Lock losses (N)** keeps this batch's losses as a fixed set. **Replay locked** then
plays exactly those games again with whatever settings the form holds at that moment
- budget, beam, replies, endgame knobs - so a tuning change is measured on the same
boards instead of on a fresh random batch. The bar shows the set's seed and board
size and, once a batch has replayed it, how that batch did: "this batch: 3 won, 9
still lost". Games that came from the locked set are tagged `was LOSS` in the list.

This is exact rather than approximate. A game is fully determined by the batch seed
and the number of rng draws consumed before it started, and `benchjson` reports that
count per game as `draws` in its `gameStart` event. A replay rewinds the stream to
each recorded count, so the board, the clock and every one of White's replies are
identical and only the search differs. Checked by replaying a locked set with
unchanged settings: same winners, same margins, same move sequences.

The set survives a reload (`localStorage`), but it belongs to the seed and engine
build it was recorded from - lock again after changing either. Locking from a
replay batch works the same way and records the same draw counts.

#### Explain (the loss replay)

**Explain** renders the game as plain ASCII in the page; **Write file** saves the
same text and reports the path; **Copy** puts it on the clipboard. Either button
works on any game, not just losses.

The text is one line per Black move — `n  Black  p(win)  delta  flat  swing
d/nodes/ms  White  B:W  evalW  rules  mdl p  flag` — followed by a block for every
blunder: the position before the move, the boards, what the evaluator said at each
step, the alternatives the search ranked, and how likely the reply that broke it
was. Flags are:

| flag | meaning |
|---|---|
| `BLUNDER` | `p(win)` of this move minus the next one is above the threshold (0.15) |
| `SWING` | the same drop on the **fixed-depth** series, i.e. the position really got worse |
| `CAPPED` | the value is 1.000 from a heuristic leaf: a cap, not a certainty |

`flat` is the value of a fixed one-ply search (Black's move, then the modelled
White replies, then the leaf), so it means the same thing on every move. The
search value does not: it depends on how deep the node budget happened to get, and
that is what most `BLUNDER` rows turn out to be. The per-blunder verdict line says
which of the two it is; the measurement behind that is in "Known limits".

The move lists are not shipped over the event stream: the snapshot carries
summaries only, and `GET /api/bench/game?index=N` returns one game's full record on
demand. The archive is capped at 2000 games, and keeps the most recent ones;
**Games per faction** has no upper limit, so a long run is bounded by its own
wall time rather than by a number in the form.

Each move record also carries an `audit` object (what the leaf evaluator said at
the root and after the move, the top three root alternatives, White's modelled
replies with their probabilities) and each reply carries `whiteAudit` (the eval
after it and the modelled probability of the move White actually played). That is
the data the explanation is built from, so it is on unless the start request sends
`"audit": false`. It costs a fixed one-ply search plus one policy build per move:
under 10% on 5x5 and 7x7, about 13% at 13x13, and about 50% at 19x19 with a
3000-node budget (where that fixed cost is the same size as the search).

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

Two more serve the loss explanation:

| endpoint | returns |
|---|---|
| `GET /api/bench/game?index=N` | one archived game with its full move list and audit |
| `GET /api/bench/game?index=N&format=text` | `{index, text, path: null}` — the replay, not written |
| `POST /api/bench/explain` `{index, threshold?, write?}` | `{index, path, text}` — writes under `temp/lost-games/` unless `write` is `false` |

`threshold` defaults to 0.15 (the `BLUNDER` marker).

`POST /api/bench/start` also accepts `replay: [{faction, game, draws}, ...]` (the
values a previous run reported per game), which plays exactly those games instead of
generating a batch; `size` and `seed` must be the ones the set was recorded with,
and every other field - the budget included - is the tuning to test. The engine's
`benchjson` config takes the same array.

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

# Fixed-depth search benchmark on one reproducible position set, sized to
# ~20 s; prints per-search lines live and a summary.
./scripts/mcgs.sh optbench
./scripts/mcgs.sh optbench --seconds=40 --positions=6 --depth=3
```

`IPVGO_TUI=1` forces the terminal view, `IPVGO_TUI=0` prints one line per game,
`IPVGO_TRACE=1` prints every move, and `IPVGO_TRACE_BOARD=1` also dumps each
position as JSON so it can be fed straight back to `exploitmove` for deeper
analysis:

```bash
IPVGO_TRACE=1 IPVGO_TRACE_BOARD=1 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Slum Snakes" 9 1 2 1
```

`IPVGO_EXPLAIN=1` answers "why did it play that": for every move it prints the
win probability of the chosen move, the next few root alternatives with their
values, the top of the opponent reply distribution White faced, and then what
White actually played with the probability the model gave it:

```bash
IPVGO_EXPLAIN=1 IPVGO_NODE_LIMIT=4000 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Netburners" 7 1 2 2
```

The static life analysis has its own command, and three switches (all off by
default because none of them measured a win-rate gain - see "Known limits"):

```bash
./out/build/x64-Release/bin/ipvgo_game safety position.json   # per-chain pass-alive verdict
IPVGO_SETTLE=0.5 IPVGO_VITAL=1 ...  # discount unsettled territory, use the Vital level
IPVGO_EYE_FILTER=1 ...              # never play inside our own pass-alive eye
```

`exploitplay` also takes two cache switches:

- `IPVGO_NO_SESSION=1` - disable the session cache, giving the A/B baseline.
- `IPVGO_CACHE_STATS=1` - report nodes, memo hits, how many of those came from an
  earlier move, reply-cache hits, endgame budget cuts, session size and how many
  times the session was dropped because a new game started.

```bash
# Same binary, both modes, so the comparison is fair
IPVGO_CACHE_STATS=1 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Netburners" 5 4 2 1
IPVGO_CACHE_STATS=1 IPVGO_NO_SESSION=1 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Netburners" 5 4 2 1
```

## Profiling

For a repeatable CPU-profile workload, open the repository root in Visual
Studio, select the **`x64-Profile`** configuration (`RelWithDebInfo`) and the
`ipvgo_game` target, then launch it with `profileworkload` as its command-line
argument. `x64-Release` is tuned for throughput (whole program optimization,
`/GL`+`/LTCG`) and is the wrong build to read a profile from; `x64-Profile`
keeps the same optimisation level but adds `/Zi` (PDB), `/Zo` (line info for
optimized code), `/Oy-` (frame pointers) and `/Ob0` (inlining off), plus a
`/DEBUG:FULL` link, so every sample resolves to the line that did the work.
Rebuild after changing the CMake configuration:

```powershell
.\cmake\Build-Native.ps1 -BuildType RelWithDebInfo -Configure -Target ipvgo_game
.\out\build\x64-Profile\bin\ipvgo_game.exe profileworkload
```

Both configurations use Ninja, so on Windows they need an MSVC environment.
Visual Studio supplies it automatically and VS Code passes it through
`"cmake.useVsDeveloperEnvironment": "always"`; in a plain terminal use
`Build-Native.ps1`, which sets the environment up itself.

This plays 25 seeded 9x9 games against Illuminati through the same search and
simulated-opponent path as gameplay, with a 5,000-node cap per Black move and a
persistent search session for each game. It prints progress after each game and
took about one minute in a Release run; actual time depends on hardware. Pass a
smaller game count for a shorter profile, for example `profileworkload 5`. An
optional second argument changes the seed.

To see where time and allocations go without an external tool, the profile build
also has a built-in `prof` subcommand (not present in Release: it replaces
`operator new`, which the performance build must not pay for). It counts
allocations per calling function, then samples every thread's stack with
`StackWalk64` over the same games, and prints the top allocation sites plus
exclusive/inclusive cost per function, hottest source lines and caller->callee
edges. It needs the PDB next to the exe and no elevation:

```powershell
# ipvgo_game prof [faction] [boardSize] [games] [nodeLimit]
.\out\build\x64-Profile\bin\ipvgo_game.exe prof "Slum Snakes" 7 3 4000
```

The default profile configuration disables inlining (`/Ob0`) so that every sample
resolves to the line that did the work, which makes absolute times several times
slower than Release; read the shares, and confirm any speedup with `optbench` on
Release. Configure once with `-ProfileInlining`
(`.\cmake\Build-Native.ps1 -BuildType RelWithDebInfo -Configure -ProfileInlining`) to
keep `/Ob2` instead: the numbers stay closer to Release (about 1.2x) at the cost of
some leaf frames collapsing into their callers.

The sampler suspends the other threads to read their stacks, so it must not allocate
inside that window: a suspended thread can hold the heap lock, and the first version of
this tool deadlocked roughly one run in three. Samples now live in a preallocated
fixed-size array (`SampleStack`), and nothing on the sampling path touches the heap.

To profile from the command line instead of Visual Studio, use the ETW
profiler from an elevated prompt:

```powershell
xperf -on PROC_THREAD+LOADER+PROFILE -stackwalk PROFILE
ipvgo_game.exe optbench --positions=2
xperf -d trace.etl
xperf -i trace.etl -o trace.csv -a dumper   # then pivot the Stack column
```

## Performance baseline

Reference point for optimisation work: the **reply-reuse pass** (below), measured
on top of the earlier search-optimisation pass that followed `68813bf` (chain and
liberty caches, narrowed bit kernels, local bit-plane legality, shared legal-move
scan, allocation-free liberty counts, inline neighbour lists). The old A/B flags
are gone; these paths are the only ones. Measure against these numbers, not
against older commits.

Reproduce, from a Release build:

```bash
# Fixed-depth search cost; threads=1 keeps it deterministic
./out/build/x64-Release/bin/ipvgo_game optbench --positions=2 --depth=3 --threads=1 --reps=3
./out/build/x64-Release/bin/ipvgo_game optbench --size=9 --positions=4 --depth=2 --threads=1 --reps=3

# The configuration the game actually runs: a node budget, one thread so the
# node counts stay deterministic.
IPVGO_THREADS=1 IPVGO_NODE_LIMIT=4000 IPVGO_CACHE_STATS=1 \
  ./out/build/x64-Release/bin/ipvgo_game exploitplay "Slum Snakes" 7 4 2 1
```

| measurement | current baseline |
|---|---|
| `optbench` per search (2 positions, depth 3) | ~185 ms (was ~192 ms before the move-generation pass, ~230 ms before the legality pass; wall clock is noisy, the node counts are the stable part), 39 012 nodes |
| `optbench` position 1 / 2 | 11 181 nodes / 27 831 nodes (deterministic; values are win probabilities) |
| `optbench --size=9 --positions=4 --depth=2 --threads=1 --reps=3` | ~77 ms/search (was ~78 ms before the move-generation pass, ~102 ms before the legality pass), 11 537 nodes |
| `exploitplay Netburners 5 8 2 1` @4000, 1 thread | 668 ms think for 8 games (was 699 ms), same results |
| `exploitplay Netburners 5 24 2 1` (fixed depth) | ~3.3 ms/move |
| `exploitplay "Slum Snakes" 7 4 2 1` @4000, 1 thread | 2.79 s think (was 2.98 s), same nodes and moves |
| `exploitplay Illuminati 9 2 2 1` @4000, 1 thread | 2.91 s think (was 3.66 s), same nodes and moves |
| `exploitplay Illuminati 13 1 2 1` @4000, 1 thread | 16.0 s think (was 16.9 s), same nodes and moves; peak RSS 61.6 MB |
| `exploitplay <faction> 19 1 2 1` @4000, 1 thread | works. Before the move-generation pass every 19x19 run died with `0xC0000409` (see that section) |
| `profileworkload 5` (Illuminati 9x9) | ~13.9 ms/move before the reply-reuse pass |

Nodes, memo hits, chosen moves and values are identical before and after the
pass at every configuration above except where noted; only the wall clock moved.
The remaining time is still `buildPolicyModel` / `getEyeCreationMoves` inside
`opponentReplyDistribution` (eye analysis, not pattern matching - see
"Known limits").

### The reply-reuse pass

Profiled with `prof "Slum Snakes" 7 10 4000` (the in-game configuration: 7x7,
`nodeLimit=4000`, one thread). The profile build is not a speed measurement, only
a share measurement, because it disables inlining.

What it showed, per move: 169 k allocations, 60 bytes each; 77% of the time
inside `opponentReplyDistribution`, of which `buildPolicyModel` was 54% and the
eye work inside it (`getEyeCreationMoves` 26%, `getEyeBlockingMove` 11%) most of
that; `matchesAnyPattern` was 3.1% of exclusive samples (the 58% figure in the
older notes predates the bitset rewrite).

Three changes, each verified to keep node counts, memo hits, chosen moves and
values bit-identical:

- **A reply-distribution table owned by the search.** Iterative deepening revisits
  every White node of the previous iteration at a different remaining depth, and
  the memo cannot answer those (it is keyed by depth), so the policy model - the
  single largest cost - used to be rebuilt once per node per iteration. The
  distribution is a pure function of the position, so a search-owned
  `ReplyCache` keyed by `positionKey()` is exact. It lives only for one
  `runExploiter` call, which sidesteps the memory problem that keeps
  distributions out of the cross-move session (872 MB on 13x13). This is where
  the 9x9 gain comes from: 39 246 hits per 203 moves, 6.47 s down to 4.05 s. On a
  13x13 game at the same budget it is 47 656 hits and 5.93 s down to 3.27 s, for
  3.7 MB of extra peak RSS (57.9 -> 61.6 MB); the table is capped at 200 000
  entries, past which a miss simply recomputes, so a very large budget cannot
  grow it without bound.
- **One pass over the chain set in the leaf eval.** `evaluatedLead` counted stones
  with its own board scan and `leafValue` counted empties with another; both now
  come from the chain set that is already in hand, and the empty-space loop reads
  the neighbour table instead of rebuilding `onBoardNeighbors` per point.
- **Membership test before the pattern match** in `patternPoints`. The available set
  is a small subset of the board and both tests are pure, so the points and their
  order do not change.

Two ideas were tried and rejected:

- **Hashing `positionKey()` from the packed 2-bit board** instead of cell by cell
  (81 FNV steps for a 9x9). It looked safe - packing is injective, so the keys
  should be interchangeable - but it changed the node counts of the budgeted,
  session-reusing play by 0.4% and flipped one 9x9 game. Single searches at a
  fixed depth were identical, so the divergence is confined to the cross-move
  memo, which is exactly the path `IPVGO_CARRY` already warns about. Rejected
  until the cause is understood.
- **Memoising `getAllEyesByChainId` per (board, colour) in a small per-thread
  ring.** One distribution asks for the same pair up to four times, but the ring
  is evicted by the candidate boards analysed in between, and the hits that do
  land cost a `ChainSet` copy. Measured inside the noise (7x7 3.62 s -> 3.67 s,
  9x9 4.06 s -> 3.99 s), so it is not in the tree.

The next targets, from the profile taken after the chain-pass round (9x9 Slum Snakes, 2
games, 4 000-node budget, one thread, 89.0 ms/move instrumented against 23 ms in Release -
the instrumented build pays the `operator new` hooks and the sampler, so read shares, not
absolute times): `computeChainsInto` 19.7% (it now owns the liberty work; the fused inner
loop at `go_game.cpp:163-169` is 10% of the run), `eyeTotalsAfterMove` 13.6%,
`matchesAnyPattern` 6.0%, `placeStoneBits` 4.9%, `neighborChainsOfChain` 3.4%,
`getAllValidMoves` 3.1%, `getEyeCreationMoves` 2.8%, `chainEffectiveLibertiesWords` 2.7%,
`summarizeEyes` 2.1%, `bits::flood` 1.9%, `opponentReplyDistribution` 1.9%,
`validateMove` 1.7%. Inclusive: `opponentReplyDistribution` 71% -> `buildPolicyModel` 46%
-> `getEyeCreationMoves` 29% (`eyeMove` 18% + `eyeBlock` 11%), and `leafValue` 17%.

What that leaves:

- **`leafValue` builds its own `ChainSet`** - the largest single flow in the profile. A
  leaf needs stone counts, the empty regions' border colours and the chains at two
  liberties; all three are reachable from the bit planes with word operations, which would
  take the leaf evaluation off the chain set entirely. The safety and moyo knobs need the
  chain set, so the bit-plane path would be the default-knobs path only.
- **`matchesAnyPattern` is evaluated per point**, nine cell classes at a time, when the
  same question can be asked for the whole board at once: for each of the nine
  pattern offsets and each cell class, one shifted mask, then each pattern is an AND of
  nine masks. That is ~20 patterns x 9 word-ops per board instead of per point.
- **The eye increment is the other half.** `eyeTotalsAfterMove` is still 11.7% on its own
  on top of `summarizeEyes`, and the eye generators together are 29.4% of the run.
- **The chain pass visits every neighbour twice.** Fusing the liberty collection into the
  flood fill would halve that, but it changes the order liberties are stored in, so the
  liberty oracle would have to be re-run against every consumer (see "The bit-plane
  pass"). Doing it with the bit planes instead - flood the chain as words, collect
  `neighbours & empty` - keeps the order and is the cheaper version of the same idea.

Allocation churn is still large and now measurable per site: 162 673 allocations per
move (12.5 M over the two profiled games, 1.56 GB of traffic). The biggest sites are
`getAllValidMoves`' `vector<pair<int,int>>` (1.4 M allocations from `reserve` plus
copy), `getLibertyGrowthMoves` (1.69 M), `getExpansionMoveArray` (1.61 M),
`EyeCandidate` vectors (0.89 M) and `ReplyDist` copies (173 k at 828 bytes each). The
per-thread free list makes these cheap in Release, but they are the reason the
instrumented build reads 4x slower than Release.

### The incremental eye pass

`getEyeCreationMoves` decides whether playing at a point creates an eye or a
living group, and it used to answer that per candidate by rebuilding the board:
`evaluateMoveResult` (a board copy plus the bitwise capture sweep), a chain flood
fill, then the whole eye map - for every liberty of every friendly chain.

One stone cannot change anything outside the empty region it lands in and the
chains it joins, so the totals after the move follow from the analysis of the
board before it (`summarizeEyes` builds that in fixed storage: one count per
stone chain and one owner list per empty region, no map, no vector, no `ChainSet`
copy). `eyeTotalsAfterMove` then:

- drops the contribution of the regions that are touched - the one the stone
  lands in, which is cut into connected components by the stone, and every region
  touching a chain the stone joins,
- re-derives those components' verdicts on the board after the move, with the
  joined chain folded into one id,
- and reports the totals as a delta from the chains whose count actually changed.

It refuses, and the caller falls back to the board-wide analysis, when the
position is outside what that reasoning covers:

- the move captures, because stones then disappear wherever the captured chain
  reaches;
- a region's verdict came from `chainsThatFullyEncircle` (a region with several
  borders of one colour, which only counts as an eye if one of them wraps it) and
  the move disturbs it: joining a chain that borders it changes both the border and
  the bounding box the test compares, and joining two chains can collapse two of
  the chains around an expanded region into one;
- a re-derived component turns out to have several borders of one colour.

`ipvgo_game eyetest [games] [seed]` is the oracle: it walks seeded games and, for
every legal point and both colours, compares the incremental totals with the full
analysis of the board after the move. 49 041 candidate points over mixed board
sizes and factions: 0 mismatches, 79% answered incrementally.

Two integer overflows inside the region walk cost a day of debugging and are worth
remembering: the "visited" marks are generation-stamped and reused across calls, so
the generations for a call have to be reserved *before* the first mark is written -
an early refusal that left marks behind made the next call treat parts of a region
as already visited, which shows up as an eye that does not exist.

Gain in Release, identical node counts and moves throughout: ~6% on the fixed-depth
`optbench` searches (which have no reply reuse to confound it) and 3-5% on the
budgeted in-game path. That is less than the profile's shares promised, and the
reason is the profile build: it disables inlining, which inflates code that is
mostly small calls (the old eye pass was chains of `ChainSet::members`,
`SimpleBoard::operator[]` and allocator traffic). Rebuilding the profile
configuration with `-ProfileInlining` gives 29 ms/move against a Release 26 ms/move,
and the shares from *that* build are the ones to plan with.

### The bit-plane pass

`fast_queries.cpp` answered "how many liberties would this stone have" and "how
weak is the chain next to this point" by walking the chain stone by stone with a
per-thread stamp array. Those questions are asked for every liberty of every
chain, for both colours, twice per reply distribution, and `walkChain` alone was
8.5% of the time in the inlining profile - with `computeChainsInto` (13.3%) the
two were the largest items.

`BoardBits` loads the position's bit planes once and answers the same questions
with word floods (`bits::flood` / `bits::neighbours` over `uint64_t[6]`, which the
capture sweep already used):

- `effectiveLibertyCount` - flood the friendly stones the new stone would join,
  then count `neighbours(chain) & empty` and drop the point itself;
- `minAdjacentLibertyCount` - the same per adjacent chain, minimum over them;
- `weakestAdjacent` - first-minimum chain in N/E/S/W order, its stone count, its
  liberty count, and how many distinct chains its liberties belong to (that last
  one from the caller's chain set, as before).

`selftest` now checks all three against the chain-based reference implementations
(`findEffectiveLibertiesOfNewMove`, `findMinLibertyCountOfAdjacentChains`,
`findEnemyNeighborChainWithFewestLiberties`) over 160 random boards from 5x5 to
19x19: 11 832 queries, 0 mismatches.

Release, identical node counts and moves throughout: `optbench` fixed depth
226 -> 204 ms/search (-11%), 7x7 at the in-game budget 3.35 -> 3.02 s (-9%), 9x9
3.88 -> 3.71 s (-4.5%), 13x13 16.9 -> 16.0 s (-5%). The gain shrinks with board
size because a flood costs more words per iteration, while the stone walk costs
the same per stone.

Also in this pass, and measured as **not** worth anything:

- **Fewer allocations.** The eye analysis was the largest allocation site in the
  engine (`std::vector<EyeCandidate>` per reply distribution, plus the `AiMove` list
  the eye moves were built into and sorted). Both are gone - the candidate scan now
  hands each eye to a callback, and `getEyeCreationMoves` fills four fields
  (first point, first point that creates life, and the two counts) instead of
  building and sorting a vector. Wall clock did not move, because
  `ipvgo-engine/cpp/nn/fast_alloc.cpp` already replaces `operator new` with a
  per-thread free list: small blocks cost about as much as a stack bump. Worth
  keeping for the memory traffic, but do not expect a timing win from removing
  allocations in this binary.
- **A dedicated chain slot for the leaf evaluator**, so those one-shot boards would
  stop evicting the position the move generators keep asking about. It made things
  ~3% slower: leaves revisit the same boards across siblings, so the shared ring was
  serving real transposition hits. Reverted.
- **Narrowing `ChainSet` to 16-bit offsets.** Not attempted: a flood over a 7x7
  board touches 49 points, so the arrays are already inside one cache line's worth of
  traffic per chain, and the change would touch every reader of `memberData` /
  `libertyData` for an unmeasurable gain.

### What belongs in the memo entry

The entry is the table's unit of memory, and the table holds 68 000 entries for a
7x7 game and 480 000 for a 13x13 one, so what goes in it decides whether a probe
fits in cache. It used to be 32 bytes and is now 16 (`double value`, `uint32_t
epoch`, `bool exact`): `depth` was written on every store and never read, and the
shared carry table keeps its own 16-byte entry (`value`, `history`) instead of
carrying an epoch and a flag it never consults.

The other half of the same waste was the key. Both tables - the memo and the reply
distribution cache - are keyed by the position, and both computed it: the memo as
`fnv1a64(positionKey(state), depth)`, the reply cache as `positionKey(state)`, so
every White node hashed the board twice. `memoBase()` now returns that position
half once and the reply cache takes it. Both changes are exact by construction and
leave node counts, memo hits and moves identical; together they are worth about
0.5% and half the table's memory (7.7 MB on a 13x13 game).

What is deliberately **not** packed in:

- **The reply distribution** (100-600 bytes). The memo is keyed by position *and*
  remaining depth, so a distribution hung off it would be duplicated once per depth,
  and bulk in the entry destroys the density that makes the probe cheap. It stays in
  its own position-keyed table: the experiment that kept distributions in the
  session is recorded above at 872 MB for 89 hits.
- **The chain set** (7.6 KB) or the **eye summary** (6.5 KB). At 180 000-480 000
  entries that is hundreds of megabytes to gigabytes. Entry density is the whole
  value of the table; anything kilobyte-sized has to be cached at its own
  granularity or recomputed.
- **Facts that are cheap to derive**: stone and empty counts are `popcount` over the
  bit planes, and a leaf value is already cached by the (position, depth) key that
  the table holds.

A position-keyed table with a small per-depth value array - one probe for every depth
of a position, and room to hang a distribution handle off it - is the structural
alternative to the current depth-keyed entries. It was built and measured, not just
argued about: one entry per position holding twelve slots (value, epoch and flags per
remaining depth), with the endgame's history-free key in its own tagged space.

It is exact - node counts, memo hits, moves and values came out identical, and the
entry count fell by 16% on 7x7 and 56% on 9x9 (68 702 -> 57 471, 180 009 -> 79 225)
because one entry now covers every depth a position is searched at. It is also
slower: an entry is 160 bytes instead of 16, so the table grows 2.9 MB -> 12.7 MB on
a 9x9 game, and a probe touches two or three cache lines instead of one. Interleaved,
three rounds each:

| | per-depth entries (16 B) | position-keyed (160 B) |
|---|---|---|
| `optbench --size=9 --depth=2` | 101.84 / 101.72 / 102.08 ms | 103.42 / 103.66 / 103.47 ms |
| 7x7 @4000 | 2969 / 2980 / 3048 ms | 3007 / 3062 / 3036 ms |

1-2% slower and 4x the memory, so the depth-keyed entries stay. The table is not
lookup-bound: it is density-bound, which is the same reason the payload that would
have gone in it (distributions, chain sets) stays out.

### The legality pass

`getAllValidMoves` is called for every reply distribution and validates every empty
point (13.5% of the time with the bit-plane queries in place: `validateMove` 7.7%,
the capture sweep 3.2%, and the bit-plane load behind them). Almost none of those
points can be affected by the rules that make a move illegal:

- a point with an **empty neighbour** cannot be suicide, because the new stone has a
  liberty;
- a point with **no enemy stone next to it** cannot capture, so the board after it is
  the board with one stone added.

For those two cases together - most points on a board that is not a knife fight - the
only remaining question is superko, and superko compares boards. Instead of building
the board after the move and packing it (a 361-byte copy plus a per-cell pack per
point), the scan packs the current board **once** and flips the point's two bits in
the packed probe. `BoardHistory::containsPacked()` takes the probe as it is.

Contact points, where a capture is possible, keep the bitwise capture sweep to find
the captured stones - but they patch those stones out of a scratch copy of the packed
probe instead of building and packing the whole board. `validateMove` is left for the
one-shot API (`evaluateIfMoveIsValid`, `makeMove`), which needs the resulting board
anyway.

Exact by construction, and verified: `selftest`, `fuzz 60 11` (6874 moves, 0
anomalies), `policycheck` identical on three factions, `eyetest` 0 mismatches, and
identical node counts, memo hits and moves everywhere. Interleaved against the
previous build:

| | before | after |
|---|---|---|
| `optbench --size=9 --depth=2` | 102.22 / 101.93 ms | 79.22 / 79.48 ms |
| 9x9 @4000, 2 games | 3645 / 3681 ms | 2920 / 2898 ms |
| 7x7 @4000, 4 games | 3000 / 2955 ms | 2749 / 2836 ms |
| 5x5 @4000, 8 games | 698 / 700 ms | 669 / 667 ms |

**-22% at 9x9, -6% at 7x7, -4.5% at 5x5.** The gain scales with how many empty points
a board has, because that is how many times the old path copied and packed a board.

### The move-generation pass

The next profile (10 games, 30.3 ms/move instrumented) put the policy model's own
generators on top: `eyeTotalsAfterMove` 7.7%, `matchesAnyPattern` 6.4%,
`getEyeCreationMoves` 4.4%, `neighborChainsOfChain` 3.9%, `summarizeEyes` 3.6%,
`BitPlanes::load` 2.9%. Three structurally cheap wins came out of it, each measured
on its own with interleaved `optbench` runs (same node counts, 39 012 and 11 537).

**Pattern scan, once per position.** The pattern generator used to walk the whole
board to test `matchesAnyPattern` in two separate functions, one returning the first
matching point and one returning the list; `patternPoints()` did the same walk again
for the caller that only wants the point list. The list is now cached
(`patternCache_`, `patternCacheReady_`) and both entry points read it. -1% on a
10-game 9x9 workload (7100 vs 7176 ms).

**Bit planes loaded once.** `getSurroundMove`, `getLibertyGrowthMoves`,
`getDefendMove` and `patternPoints()` each built their own `BoardBits` from the
board, so the same position was packed three or four times per node. `MoveGen` now
owns one `bits_` member and passes it down. With the pattern cache above: -2.5% on
the 2-position depth-3 bench (193.4 -> 188.5 ms) and -2.1% on the 9x9 bench
(79.0 -> 77.4 ms).

**16-bit chain arrays (and a real buffer overflow).** `ChainSet`'s five index arrays
held `int` where every element is a point index (0..360) or a small count. Narrowing
`id`, `memberOffsets`, `memberData`, `libertyOffsets` and `libertyData` to
`int16_t`/`uint16_t` halves the bytes the chain pass touches on every node, and
`ChainSpan` yields `int` so readers did not change. Timing: -1.5% on one bench,
+1.4% on the other, i.e. **neutral** - the chain pass is arithmetic-bound, not
bandwidth-bound.

The narrowing did expose something that matters more than the timing. `libertyData`
was sized `kMaxPoints` (361) but holds one entry per (chain, empty point) pair, and
an empty point can touch four chains. A temporary counter showed 19x19 positions
reaching **368 pairs** - a seven-element write past the end of the last member of
`ChainSet`. Every 19x19 `exploitplay` on the old binary dies with exit code
`0xC0000409` (`STATUS_STACK_BUFFER_OVERRUN`); the same run on the new one finishes and
wins. The array is now `kMaxPoints * 4` (1444), the true bound, and `selftest` builds a
19x19 checkerboard - the worst case, 684 pairs - to check that every listed liberty is
really an empty neighbour and that the total fits.

**No temporary vectors in the generators.** `getSurroundMove` flattened the enemy
liberties into one vector and then filled three more (`captureMoves`, `atariMoves`,
`surroundMoves`) only to return element `[0]` of one of them; `getGrowthMove` and
`getDefendMove` built lists of ties only to pick one of them. All five are gone: the
surround scan iterates chains and liberties directly (the order the flattened list
had) and remembers the first move of each kind, and the tie-breaks count matches on a
first pass and index into a second, drawing from the same RNG with the same count.
`getDefendMove` also reuses the cached growth list instead of rebuilding it. This was
expected to be allocation hygiene only - `fast_alloc.cpp` gives `operator new` a
per-thread free list - but the vectors were per node, not per search: **-3.4%** on the
2-position bench (192.2 -> 185.6 ms) and **-4.1%** on the 9x9 bench (80.7 -> 77.4 ms).

Cumulative, measured directly against the build that started the pass (4 interleaved
rounds on the 2-position bench, 8 on the 9x9 one): **-3.9%** (192.5 -> 185.0 ms) and
**-1.6%** (78.3 -> 77.1 ms). The per-step percentages above are larger than these and
do not add up, because each step's "after" binary became the next step's "before" and
the wall clock drifts a few percent between sessions; the direct comparison is the one
to trust. Node counts, memo hits, chosen moves, margins, `policycheck` values and
`eyetest` counters are identical throughout (`eyetest` still 49 041 candidate points,
38 652 on the incremental path, 0 mismatches).

### The chain-query pass

The fresh profile above put the bit-plane liberty queries second on the list: 15.7% of all
samples, with one line (`floodChainInto`, the word-level flood) at 11.3%. That was the
cost of answering, per candidate point, a question the cached `ChainSet` had already
answered: a stone placed on an empty point joins the (at most four) chains of its colour
around it, so the liberties of the merged chain are the known liberty lists of those
chains - a flood is not needed.

`analysis.cpp` now answers all three questions the move generators ask:

- `chainEffectiveLiberties`: a `uint64_t` mask of the liberties of the adjacent friendly
  chains, plus the empty neighbours of the point itself, minus the point; the mask width
  is dispatched on the board size exactly like the bit-plane code, so a 9x9 position
  touches two words and not six.
- `chainMinAdjacentLiberties`: `min(libertyCount(chain))` over the adjacent friendly
  chains, 99 when there are none - O(1) per adjacent chain.
- `chainWeakestAdjacent`: the adjacent enemy chain with the fewest liberties (first in
  N/E/S/W order on ties), its size, and the number of distinct empty regions its
  liberties belong to (capped at 8, as before).

`BoardBits` is no longer used by the search. It is kept because it is the only
*independent* implementation of these answers - the reference in `analysis.cpp` walks the
same chain set, so it cannot catch a chain-set error, while the bit planes re-derive
everything from the board. `selftest` now checks all three side by side over 11 832
queries, and it caught a real mistake on the first run: the point's own empty neighbours
are liberties of the stone being placed even when no friendly chain reaches them, so the
union has to include them (the first version dropped them and read one too low at 19x19).

Measured on Release, interleaved, identical node counts and identical `exploitplay`
results at 5x5/7x7/9x9/13x13/19x19: **-10.4%** on the 9x9 bench (86.4 -> 77.5 ms per
search) and **-3.3%** on the 2-position depth-3 bench (203.0 -> 196.4 ms). The profiled
workload dropped from 102.7 to 88.6 ms/move, and the flood disappeared from the profile:
`chainEffectiveLibertiesWords` is 2.7%, against 15.7% for the queries it replaced.

Two ideas from the same profile were tried and rejected:

- **Reusing one scratch vector for `growthMaxDeltaPoints()` / `jumpOptions()`** instead of
  returning a fresh one (they were top allocation sites at 700 k and 743 k allocations).
  Measured 3.3% *slower* on the 9x9 bench, consistently over eight interleaved rounds, and
  a shared buffer invites aliasing bugs if a caller ever holds two lists at once. Reverted.
- **Growing the chain-cache ring from 6 to 12 slots** to cut the flood at leaf nodes:
  +0.2%, i.e. nothing. The misses are per leaf position, not evictions.

### The threading pass

The engine runs threaded by default (`threads = 0` means `hardware_concurrency()`; the
client never overrides it), so this was worth measuring. With a temporary instrumented
build (9x9 Illuminati, 4 000-node budget, 12 threads on a 6-core/12-thread CPU):

- **Sync.** Root candidates are split among workers, one `std::async` future each, and
  the parent joins them all - a barrier per depth iteration, with no work stealing and no
  partial results. (The futures have since been replaced by a persistent worker pool; see
  "The worker pool" below for what that changed.)
- **Split.** Contiguous blocks of `ceil(children / threads)` children, and the node
  budget divided as `nodeLimit / threads` per worker regardless of how many children that
  worker actually got. With the 29 candidates of a typical 9x9 root and 12 workers that
  is blocks of three, so 10 workers got work and 2 got none - **17% of the node budget
  was allocated to workers that never ran** - and the slowest block took 1.3-1.5x the
  mean block, which the barrier then waited for. Measured occupancy
  (worker-time / wall / threads): **63%** at both 6 and 12 threads.
- **Redundant work.** The reply cache is the only cross-thread reuse (memos are per
  worker). It had one mutex for the whole table: at 12 threads that was **3.6% of all
  thread time** waiting (0.4% at 6), and the `get -> unlock -> compute -> lock -> insert`
  pattern let two workers compute the same distribution concurrently - **5.3% of all
  reply computations were duplicates** at 12 threads (2.8% at 6).

Two changes went in, and the root split now has two modes:

- **Round-robin children** instead of contiguous blocks: worker `t` takes child `t`,
  `t + threads`, `t + 2*threads`, ... . Every worker now gets `floor` or `ceil` of
  `children / threads` of them, so no worker sits out with an unspent share.
- **Sharded reply cache**, 64 shards keyed like the carry memo, with the entry cap split
  per shard. The lock wait falls from 3.6% of thread time to 0.2%.
- **Two schedulers, chosen by `ExploitConfig::deterministic`.** The deterministic one is
  the round-robin split above: fixed subset per worker, fixed budget share, so the same
  seeds and thread count pick the same moves on every run. The faster one is dynamic
  child claiming: a worker takes the next root move when it finishes the previous one and
  each move gets an equal share of what is left of the node budget. It recovers the
  imbalance the barrier would otherwise wait for (74-90% occupancy against 63%), but
  which worker evaluates a move decides what its session memo ends up holding, so the
  play varies a little run to run. **Play uses the dynamic scheduler; the tools use the
  deterministic one** - `optbench`, `bench` and `prof` set it themselves so their numbers
  are comparable, `IPVGO_DETERMINISTIC=1` forces it for `exploitplay`/`serve`, and
  `IPVGO_DYNAMIC=1` forces the dynamic one in the tools when its speed is what is being
  measured.

Interleaved, 5 rounds, 12 threads, identical node counts:

| benchmark | before | round robin | dynamic |
|---|---|---|---|
| `optbench --positions=2 --depth=3 --threads=12` | 53.7 ms | 45.3 ms (-16%) | 44.8 ms (**-17%**) |
| `optbench --size=9 --positions=4 --depth=2 --threads=12` | 13.9 ms | 13.3 ms (-5%) | 12.5 ms (**-10%**) |
| `exploitplay Illuminati 9 6 2 1` @4000, default threads | 4.7 ms/move | 3.9-4.3 | 3.7-4.5 |

Strength is unchanged within noise: Illuminati 9x9 @4000, 6 seeds x 10 games, three runs
of the shipping (dynamic) build gave 45/60, 43/60 and 41/60 with margins -13.1, -16.3 and
-18.9, against 43/60 and -15.5 twice for the build before this pass (the round-robin mode
reproduces exactly: 42/60, margin -16.6, twice).

Most of the win came from the two structural changes rather than from dynamic claiming:
round robin removes the idle workers, and the sharded cache removes the lock wait, which
is why the deterministic mode is already 16% faster on the 2-position bench even though
it still waits on its slowest worker. The dynamic scheduler is worth the last 1-6% in
play, where the run-to-run variation does not matter.

### The worker pool

`std::async(std::launch::async, ...)` is not a thread creation on MSVC: it constructs a
`_Task_async_state`, which is `Concurrency::create_task`, so the C++ runtime hands the
task to its own pool. Measured here: 2 400 calls ran on **7 distinct thread ids** at
**3.2 us** each, against 48.7 us and 2 400 ids for a real `std::thread`. So dispatch was
already cheap. What it was not, was free: every round routes each task through the
runtime's queue, so the last worker starts later than it would if it were already parked
and directly signalled.

`exploiter.cpp` now keeps its own workers alive for the life of the process (`RoundPool`)
and wakes worker `t` for session slot `t`. The slot index, not the OS thread, is what the
memo is keyed by, so `deterministic` mode and per-worker memo ownership are unchanged -
verified by diffing `exploitplay` output line for line (moves, values, node counts,
scores) before and after, at 12 and 6 threads and at 4 000 and 1 000 nodes.

Round shape (N workers x W of work, one depth iteration, joined per round), medians of
paired interleaved trials on a 6-core/12-thread CPU:

| round | `std::async` | persistent pool |
|---|---|---|
| 6 x 60 us | 0.089 ms | 0.073 ms (-18%) |
| 12 x 60 us | 0.123 ms | 0.102 ms (-17%) |
| 6 x 2.5 ms | 2.538 ms | 2.516 ms (-1%) |
| 12 x 2.5 ms | 3.72 ms | 3.77 ms (parity: another run had the pool 4% ahead) |
| 12 x no work | 0.016 ms | 0.020 ms (**slower**) |

The last row is the honest shape of the trade, and the reason not to reach for a pool on
principle: a round that dispatches but does no work is still faster through `std::async`,
because the runtime can complete trivial tasks without parking and waking twelve threads.
The pool only pays once a round does real work, and it pays more the shorter the round is.

In the engine, paired against the build before it (deterministic mode, so node counts and
moves are identical - diffed line for line on three configurations), median of the paired
per-move think time:

| benchmark | before | after |
|---|---|---|
| `exploitplay Illuminati 9 4 2 1` @1000 nodes, 12 threads | 1.85 ms/move | 1.76 ms/move (**-4.8%**, faster in 8 of 11 pairs) |
| `exploitplay Illuminati 9 4 2 1` @4000 nodes, 12 threads | 3.13 ms/move | 3.08 ms/move (-1.1%, faster in 6 of 9) |
| `optbench --positions=2 --depth=3 --threads=12` | - | noise: runs came out 5.7% faster and 3.0% slower |

The `optbench` row is a warning rather than a result. `optbench --depth=N` runs a
**single** `searchRoot` per measurement, so it has one round and cannot amortise a
per-round cost at all; the gain only accumulates where iterative deepening runs several
rounds per move (`exploitplay`, `bench`). Do not screen this change on `optbench`.

So the gain lives where the round is short - many workers, or a small node budget - and it
shrinks as the search lengthens (4.8% at 1 000 nodes, 1.1% at 4 000, nothing measurable on
a 45 ms fixed-depth search at 6 threads). It is worth keeping because it is free and
behaviour-preserving, not because it is large. A side effect worth knowing: the workers now
live as long as the process, so each keeps one `fast_alloc` pool instead of runtime-pool
threads being created and retired (see the allocator handover below), and the engine no
longer depends on `std::async`'s platform behaviour - on libstdc++ and libc++ the same call
really does start a thread (measured 48.7 us here for `std::thread`), which would have
turned every round into twelve thread creations.

`mcts.cpp` and `mcgs.cpp` still use `std::async`; their rounds are one synchronous
split-and-merge per move, so the same change is available there if it is ever wanted.

### The superko hash and the hoisted plane load

A mutation used to spend almost none of its time on Go and almost all of it on
re-encoding. Measured on a 9x9 position with 40 moves of history, `applyMove` +
`undoMove` cost **0.397 us**, split as:

| step | us | share |
|---|---|---|
| `previousBoards.contains` - linear scan of every history entry | 0.122 | 31% |
| `packBoard` - once for the probe, once for the append | 0.168 | 42% |
| `BitPlanes::load` - chars -> 5 planes, per candidate | 0.070 | 18% |
| `SimpleBoard` copy (368 bytes) | 0.005 | 1% |
| `placeStone` floods, by difference | ~0.00 | ~0% |

Two changes, both behaviour-preserving:

- **One 64-bit hash per history entry** (`BoardHistory::hashWords`), so a superko
  question is a hash compare per historical board instead of a word-by-word
  comparison of all of them. A hash match is still confirmed on the words, so a
  collision cannot answer wrongly. This also stops the cost from growing with the
  length of the game.
- **`applyMove` takes an optional `const BitPlanes*`**, and the two search loops
  (`blackToMove`, `expectOverReplies`) load the planes once per position instead of
  once per candidate move. Every candidate is tried on the same position and undone,
  so one load is valid for all of them.

Paired, interleaved, deterministic mode so the node counts are identical - and the
`exploitplay` traces are byte-identical before and after (moves, values, node counts,
scores) at 5x5/9x9/13x13 and at 12/1/4 threads:

| benchmark | before | after |
|---|---|---|
| `exploitplay Netburners 5 12 2 1` @1000 nodes, 1 thread | 4.149 ms/move | 4.067 (**-2.0%**, faster in 8/9) |
| `exploitplay "Slum Snakes" 9 6 2 1` @1000 nodes, 1 thread | 20.787 ms/move | 19.803 (**-4.7%**, 8/9) |
| `exploitplay "Slum Snakes" 9 4 2 1` @4000 nodes, 1 thread | 63.937 ms/move | 61.986 (**-3.1%**, 9/9) |

**Negative result, worth recording.** The remaining per-node cost is dominated by
full-board chain floods (19.7% of samples), and the obvious guess is that the same
board is being flooded repeatedly. It is not. Growing the `chainsCached` ring from 6
to 32 slots measured **-0.1% on 9x9 and +0.4% on 13x13** (coin-flip ordering): the
floods are one per *candidate position the policy model evaluates*, not repeats of
one board, so no cache size can remove them. The only way is to analyse positions
incrementally - play, analyse, undo on one mutable state - which is a rewrite of the
policy model, not a cache.

Three other "obvious redundancy" ideas were checked and are already done, so the
ground should not be re-covered:

- `MoveGen`'s accessors are already memoised per position (`cached(kEyeMove, ...)`,
  `patternPoints()`, `growthList()`), even though several call sites call `eyeMove()`
  twice in one expression.
- `getEyeCreationMoves` already deduplicates repeated candidate points and already
  uses the incremental `eyeTotalsAfterMove` in preference to a board-wide
  `summarizeEyes`.
- The reply cache is not under-used because it is per move: measured with
  `IPVGO_CACHE_STATS=1` on 9x9 Slum Snakes @4000, **8318 reply hits over 100 446
  nodes (8.3%)** and 784 memo hits (0.8%, 155 of them across moves). The positions
  really are distinct, so a longer-lived cache would not repay its memory.

The one piece of real waste left in that path was a **6.5 KB `ChainSet` copy per policy
build** in `getEyeCreationMoves`, taken only to protect the ring reference from the
candidate fallback. The fallback now uses its own local chain set, so the reference is
safe and the copy is gone. Nothing reachable from that loop calls `chainsCached()`, which
is what makes the reference valid - worth re-checking if that loop ever grows a new call.

### Cumulative effect of the three exact-output changes

Paired, interleaved, `IPVGO_DETERMINISTIC=1` so the node counts are identical, 9 pairs
each, median of the paired per-move think time; the `exploitplay` traces are
byte-identical at 5x5/7x7/9x9/13x13 and at 1/4/12 threads:

| benchmark | HEAD | after | |
|---|---|---|---|
| `exploitplay Netburners 5 12 2 1` @1000 nodes, 1 thread | 4.093 ms/move | 3.936 | **-3.8%**, faster in 9/9 |
| `exploitplay "Slum Snakes" 9 6 2 1` @1000 nodes, 1 thread | 20.212 ms/move | 19.887 | -1.6%, 8/9 |
| `exploitplay "Slum Snakes" 9 4 2 1` @4000 nodes, 1 thread | 63.141 ms/move | 60.832 | **-3.7%**, 9/9 |
| `exploitplay Daedalus 13 1 2 1` @4000 nodes, 1 thread | 111.463 ms/move | 108.075 | **-3.0%**, 8/9 |

### The scheduler changes strength, not just speed

`ExploitConfig::deterministic` is not only a reproducibility switch: at 12 threads it
measurably weakens the engine. 5x5, in-game budget (1000 nodes), 40 games x 6
factions x seeds, pooled:

| scheduler | 1 thread | 12 threads |
|---|---|---|
| deterministic (fixed subset + fixed budget share per worker) | 86.3% (1243/1440) | **81.3%** (1171/1440) |
| dynamic (each worker claims the next root move) - **what play uses** | 86.0% (1652/1920) | 86.6% (1663/1920) |

The deterministic split gives every worker a fixed slice of the node budget, so at 12
threads each root move gets ~83 nodes and nothing is searched deeply
(avgDepth 4.22 against 4.59 at one thread); the dynamic scheduler recovers all of it.
Consequences:

- **Never compare strength across thread counts in deterministic mode.** A first pass
  through this comparison used `IPVGO_DETERMINISTIC=1` and "found" a 5-point penalty
  for 12 threads; in the play path the difference is 0.6 points, i.e. noise.
- Thread count makes **no measurable difference to strength** in play (86.0% vs
  86.6% over 1920 games each, sign flips between seed sets), so the client's default
  of "all cores" costs nothing and buys 3x the wall clock.
- Use deterministic mode for timing and A/B of node counts, dynamic for anything
  that asks "is this stronger".

### The leaf evaluator without a chain set

`leafValue` is the hottest single consumer of the chain pass, and it needs far less than
`computeChains` builds: stones per colour, the empty count, each **stone chain's size and
liberty count** (for the atari term) and each **empty region's size and border colours**
(for the territory term). It never reads a member list or a liberty list - the counts are
the whole interface.

`leafLeadBits<W>` computes exactly those from the bit planes, with `bits::flood` and
`__popcnt64`, and builds no `ChainSet` at all. Standalone, on real in-game positions:

| board | chains avg | full `ChainSet` | counts only | speedup |
|---|---|---|---|---|
| 7x7 | 12.9 | 1.394 us | 0.334 us | **4.2x** |
| 9x9 | 18.1 | 1.567 us | 1.021 us | 1.5x |
| 13x13 | 38.2 | 2.506 us | 0.929 us | **2.7x** |

**Why the values stay bit-identical.** `evaluatedLead` accumulates floats in chain order,
so a faster traversal is only equivalent if it visits chains in the same order. The scalar
pass discovers chains by sweeping `x`, then `y`, i.e. ascending flat index; the bit-plane
pass always takes the *lowest* unseen point, which is the same order. `black` and `white`
are separate accumulators, so interleaving stones with regions cannot reorder either sum,
and the atari term is still one accumulation in stone-chain order. Same order, same
additions, same bits - verified by diffing `exploitplay` traces (moves, values, node
counts, scores) at 5x5/7x7/9x9/13x13, which differ in no line.

Two options still need the chain structure and are guarded, falling back to the old path:
the safety discount (`IPVGO_SETTLE` != 1, which calls `analyzeSafety`) and the influence
moyo (`IPVGO_MOYO` > 0). `selftest` passes with both set.

Paired, interleaved, deterministic mode, 9 samples each, 11 of 11 pairs faster:

| benchmark | before | after |
|---|---|---|
| `exploitplay Netburners 5 12 2 1` @1000 nodes, 1 thread | 4.080 ms/move | 3.544 (**-13.1%**) |
| `exploitplay Tetrads 7 4 2 1` @4000 nodes, 1 thread | 7.295 | 6.901 (-5.4%) |
| `exploitplay "Slum Snakes" 9 6 2 1` @1000 nodes, 1 thread | 19.895 | 18.646 (-6.3%) |
| `exploitplay "Slum Snakes" 9 4 2 1` @4000 nodes, 1 thread | 61.015 | 56.789 (**-6.9%**) |
| `exploitplay Daedalus 13 1 2 1` @4000 nodes, 1 thread | 108.059 | 104.884 (-2.9%) |
| 5x5 @1000 / 9x9 @1000 / 9x9 @4000, **12 threads** | 0.901 / 3.188 / 11.850 | 0.771 (**-14.4%**) / 2.916 (-8.5%) / 10.650 (**-10.1%**) |

The 5x5 win is the largest because 25 points fit in one 64-bit word, so every flood is a
single-word loop; the 13x13 win is the smallest because the per-chain flood iterations
multiply.

### Reserve the vectors the generators fill

The two largest allocation sites in the search were push_back loops without a `reserve`:
`getExpansionMoveArray` and `getLibertyGrowthMoves` each grew their result 1, 2, 4, ... 32
entries per call, and between them that was 3.3 million allocations per two games
(~17 per node). `contactPoints` had the same shape. Reserving the known upper bound
turns each into one allocation. Output is unchanged - `reserve` cannot alter contents -
confirmed by the same trace diff at 5x5/7x7/9x9/13x13.

Paired, interleaved, deterministic, 9 samples: **-2.3%** at 5x5 @1000 (8/9 pairs),
-0.1% at 9x9 @4000 single-threaded, **-2.9%** at 9x9 @4000 on 12 threads (6/9).
Small, because the allocator is the per-thread `fast_alloc` free list, but it is free
and it removes the pointer-chasing the growth caused.

### The capture-race experiment (IPVGO_RACE, off by default)

The README's own diagnosis of the losses is that the eval has no term for the thing that
decides them: *a capturing race between a big group with few liberties and the scattered
groups around it*. The flat atari bonus prices a group in atari at 0.6 points per stone
capped at five, while capturing it is worth **two points per stone** in area scoring. But
simply paying the full value for every group in atari measured as noise earlier, because a
two-liberty group in the opening is not capturable.

`leafLeadBits` now has an optional term that pays the full value **only when the race is
actually won**: the best liberty count among the stones surrounding the target exceeds the
target's own, so it cannot run and the attacker can afford to fill. It replaces the atari
bonus for those chains rather than adding to it, so nothing is double counted.

```powershell
IPVGO_RACE=0.5 ./out/build/x64-Release/bin/ipvgo_game.exe exploitplay Netburners 5 80 2 1
```

Off by default (`IPVGO_RACE` unset or 0 skips the term entirely), so the default path is
byte-identical to before - confirmed by the same trace diff at 5x5/9x9/13x13.

Measured on 5x5 with 1 thread. Screening at a **low node budget on purpose**: the real
budget saturates at 86% wins, which compresses differences, while 200 nodes gives 70% and
games that run 3x faster, so many more can be played in the same time.

| budget | games per arm | baseline | `IPVGO_RACE=0.5` | delta | sigma |
|---|---|---|---|---|---|
| 200 | 1 920 | 69.4% | 71.9% | **+2.5** | 1.7 |
| 200 | 5 760 | 70.2% | 72.3% | **+2.1** | **2.4** |
| 100 | 4 320 | 66.1% | 67.2% | +1.1 | 1.2 |
| 1000 (in game) | 1 920 | 86.0% | 87.4% | +1.4 | 1.3 |

Paired per faction-and-seed cell, same seeds for both arms. Weights 0.25 and 1.0 at
budget 200 gave +2.0 and +2.0. **Every arm of every run is positive** - six arms, four
independent experiments, ~14 000 games - which is unlikely to be chance, but no single run
reaches 3 sigma, so treat it as a probable ~1.5-2 point gain rather than a measured one.
It is kept behind the environment variable, off, until a full 240-games-per-arm campaign
confirms it at the budget the game actually uses.

### Eval terms tried and rejected (and a warning about cheap screening)

Four more eval terms were measured with the same paired-cell method. Two are still in the
code behind environment variables (off), two were removed.

- **Worst-case White aggregation** (`IPVGO_WHITE_WORST`, already existing):
  70.2% -> 68.5%, **-1.7 points / -1.7 sigma**. Treating White as adversarial when it
  actually follows a policy loses, which is what the exploit model is for.
- **Concentration of force** (`IPVGO_CONC`): the stone-weighted average chain size,
  `sum(size^2)/sum(size)`, i.e. 23 stones in one chain scores 23 and the same stones
  scattered score 1. Positive weight (reward *our* concentration) was +1.0 at 200 nodes;
  **negative weight (reward White's, i.e. make Black spread out) was +2.7 games per
  40-game cell at 3.6 sigma**, and replicated on fresh seeds at 3.2 / 2.9 / 1.8 sigma.
- **Room to live** (`IPVGO_REGS`): regions bordered per side, +1.1 sigma. Weak.
- **Race at a 3-liberty horizon** (`IPVGO_RACE_LIBS=3`): +1.5 points at the in-game
  budget, 1.4 sigma. Slightly better than the 2-liberty version and not yet resolved.

**The warning.** The concentration term looked like the best result of the session at the
screening budget and then evaporated:

| 5x5 | budget 200 | budget 1000 (in game) |
|---|---|---|
| `IPVGO_CONC=-0.05` | +2.4 games/cell (3.2 sigma) | **-0.04 games/cell (0.0 sigma)** |
| `IPVGO_CONC=-0.1` | +2.5 games/cell (2.9 sigma) | - |

Screening at a low node budget is fast and sensitive, and the reasoning for it was sound -
more games, more headroom - but it answers "does this help a *shallow* search", which is
not the question. A term that supplies information the search cannot reach at depth 1-2 is
worthless once depth 4 finds it. **A low-budget result has to be confirmed at the in-game
budget before it means anything**, and the two can disagree in both magnitude and sign.
The same caveat applies to the older 5x5 screens recorded earlier in this file.

Pooled, the capture-race term is the only eval change that has been positive in every run
at *both* budgets: at 200 nodes +2.1 to +2.5 points (2.4 sigma at 5 760 games per arm), at
1000 nodes +1.2 to +1.5 points (1.0-1.4 sigma). Ten runs, ~17 000 games, always positive,
never individually above 2.4 sigma. Treat it as a probable ~1.3 point gain at the in-game
budget and keep it off until a campaign resolves it.

Since the remaining eval terms are at the horizon's edge, the next lever is the **search**,
not the leaf: a quiescence extension that keeps searching forcing moves (captures, atari
replies) past the depth limit, instead of evaluating statically exactly where the losses
are decided.

### Two ideas measured and rejected

- **Cache-line padding.** `SearchSession::Impl::Slot` is exactly 64 bytes but a
  `std::vector` only guarantees 16-byte alignment, so neighbouring slots shared a line;
  `Shard {mutex, map}` is 144 bytes, so nearly every adjacent pair did. Both look like
  textbook false sharing. Padding `Slot`, both shard arrays and `RoundPool::Worker` to
  64 bytes measured **+1.2%, +1.7%, -0.6%, -0.5%, +0.8%** against a ~1% noise floor -
  nothing. Coherence traffic is not the bottleneck; the per-node working set is L1
  resident, so there is no line pressure to relieve.
- **The shared carry table as a cross-worker cache** (the substrate a lazy-SMP search
  would need). `IPVGO_CARRY=1` gives every worker and every search of the session one
  sharded, mutex-guarded memo. It is **not** free: at 9x9 @4000 on 12 threads it is
  **3.2% slower** (the lock traffic costs more than the hits save) and at 9x9 @1000 it
  is 8.2% faster. It also changes the search - `avgDepth` 3.547 -> 3.595 at the same
  budget - because a hit does not consume nodes, so the budget stretches further. True
  lazy SMP (every worker on one tree, shared table, divergent ordering) is therefore a
  strength change that needs the full 240-games-per-arm campaign, not a free win.

### The allocator handover

Long bench runs grew until the machine swapped: 100 games per faction on 5x5 at a 200 ms
think budget ended with the engine holding 24 GB, against a few hundred MB for the same
run a day earlier. It is not the search or the memo - it is the small-object pool behind
`operator new` (`fast_alloc.hpp`), and the trigger is the threading pass above: a fresh
set of worker threads is created for **every move** and joined at the end of it.

Each thread carved its own 256 KB chunks and kept its own free lists, and when the thread
exited, both were dropped on the floor: the chunks are never returned to the OS by
design, and nothing else could reach the freed blocks. Measured on the 40-game 5x5 bench,
memory grew ~240 MB per game (9.6 GB in total, ~370 bytes per node); with `optbench`
it grew 7.4 MB per search at 12 threads and stayed flat at one thread, because the main
thread's pool survives.

Two designs failed before the third worked, and both are worth remembering:

- Draining the shared lists **block by block under the lock** put a global mutex on every
  allocation that missed the local list and serialised all twelve workers; a 20-repetition
  bench that normally takes 1.7 s did not finish in ten minutes.
- Draining **whole class chains** per thread fixed the contention but not the growth: a
  thread that took every block of a size class held them while its neighbours carved
  fresh chunks, so the pool still grew by a peak working set per move (25 000 blocks per
  12-thread round in a standalone reproduction).
- `new Globals()` for the shared pool deadlocked the process in `--threads=1`: that `new`
  goes through the very `operator new` being defined, re-enters `allocate()`, and waits on
  the initialisation guard of the same static. The pool now lives in static storage via
  placement new.

What shipped: a thread keeps at most 256 blocks per size class, takes up to 128 from a
process-wide pool at a time, hands its surplus back when a list exceeds that ceiling, and
donates its lists and its spare chunk tail when it exits. Memory is then bounded by the
peak working set of one move rather than by the length of the run:

| workload | before | after |
|---|---|---|
| `optbench --positions=2 --depth=3 --reps=200` (12 threads) | 1466 MB and climbing | 36 MB flat |
| `benchjson` 40 games, 5x5, 200 ms budget | 9639 MB and climbing | 346 MB, plateau |
| standalone: 60 rounds x 12 threads x 20 000 allocations | +3 MB per round | 11 -> 13 MB total |

Node counts (39 012 and 11 537) and `selftest`, `fuzz 60 11`, `eyetest` are unchanged, and
per-search time is unchanged or slightly better (39.3 ms against 38.5 ms at 12 threads,
172.2 ms against 172.3 ms single-threaded).

The remaining per-move cost this exposes is the thread churn itself: 12 threads created
and destroyed for every move is ~150 000 thread creations over a 600-game bench. A small
persistent worker pool would remove both that and the allocator's dependence on exit
handover, at the price of a dispatch barrier to reimplement; it is the next thing worth
measuring here, not another micro-optimisation of the search.

### The chain-pass round

Two changes to `computeChainsInto`, which is the largest single cost and now does all of
the work in one sweep:

- **Liberties are collected as each stone is discovered**, not in a second pass over the
  chain. Discovery order *is* the stored member order and each stone's neighbours are
  visited in the same N/E/S/W order either way, so the liberty lists come out identical -
  checkable: single-thread `exploitplay` results and node counts are unchanged - while
  every point's neighbours are visited once per chain build instead of twice. Those two
  scans were the first and third hottest lines in the profile. **-2.5% / -1.7%**
  (2-position depth-3 bench / 9x9 depth-2 bench, single thread, interleaved).
- **Empty regions record which colours border them** (`ChainSet::border`, two bits,
  filled during the same neighbour scan). The leaf evaluation asks "is this region
  bordered by exactly one colour" for every region on every leaf, and it was walking the
  region's members again to answer it; with the flags it is two bit tests.
  **-1.3% / -4.5%**, and `evaluatedLead` drops out of the exclusive top list.

The selftest oracle for the border flags - compare the recorded flags against a member
scan on 120 random boards - caught a real bug in the first version: offline nodes (`#`)
were being counted as White borders, which would have mis-valued every region touching an
obstacle. That is exactly the kind of silent error the flags introduce, so the check
stays.

**3. The eye delta finds its regions from the liberty lists (kept, -1.7% / -2.4%).**
`eyeTotalsAfterMove` runs once per eye *candidate point*, and it used to walk every stone
of the chains the move joins, plus all their neighbours, to discover which empty regions
those chains border. Those regions are exactly the ones the chains' liberty lists live in,
and the chain pass already keeps those lists - so the walk is now the chain's perimeter
instead of its area. `eyetest` is unchanged bit for bit (49 041 candidate points, 38 652
on the incremental path, same declines), which is the check that matters here.

Rejected after measuring: **reordering the nine pattern-mask tests** to try the centre and
orthogonal neighbours first (+0.3%, noise). The early exit already prunes most points in
the first few cells.

Also rejected, and instructive: **skipping the re-derivation of regions that cannot
change.** A region bordered by one merged piece and credited to that piece looked like it
had nothing to re-derive - merging pieces of one colour keeps its verdict, and its eye
moves to the merged chain, which is already in the starting total. That version produced
2 000-3 000 `eyetest` mismatches, even after restricting it to boards with no
encirclement-credited regions. The reason is the encirclement test itself: it compares the
*bounding box* of the bordering chain with the region's, and a chain's box changes when
unrelated cells join it, so a region whose own cells are untouched can still flip verdict.
The skip is out; the profile line `analysis.cpp:655` (the component flood) stays.

Profile after this round (same workload as above): `computeChainsInto` 19.7% (it now
contains the liberty work, so its share rose while the total fell), `eyeTotalsAfterMove`
13.6%, `matchesAnyPattern` 6.0%, `placeStoneBits` 4.9%, `neighborChainsOfChain` 3.4%,
`getAllValidMoves` 3.1%, `getEyeCreationMoves` 2.8%, `chainEffectiveLibertiesWords` 2.7%,
`summarizeEyes` 2.1%, `bits::flood` 1.9%, `opponentReplyDistribution` 1.9%,
`validateMove` 1.7%; the hottest lines are now the fused inner loop
(`go_game.cpp:163-169`, 10% between them) and `analysis.cpp:655` in the eye delta.

### The cleanup pass

Everything the passes above added is now the only path. No switch selects a slower
implementation, and the code that existed only to reproduce one is gone.

Removed because nothing called them any more (each verified with a repo-wide search
after the pass that obsoleted it):

- `boardEqualsFlat`, `simpleBoardFromString`, `getEmptySpaces` - leftovers from the
  board-equality superko check and from test scaffolding.
- `neighborChainIndices` - a vector-returning view of `neighborChainsOfChain`, whose
  callers moved to the fixed-storage version.
- `getPatternMove` - superseded by the cached `patternPoints()`; the generator now
  has one board walk instead of two.
- `enumerateFactionMoves` - wrapper over `enumerateFactionMovesImpl`; only
  `enumerateOpponentMoves` is used.
- The four chain-walk liberty queries in `fast_queries.cpp`
  (`effectiveLibertyCountFast`, `findEffectiveLibertiesOfNewMoveFast`,
  `findWeakestAdjacentChainFast`, `findMinLibertyCountOfAdjacentChainsFast`) plus the
  `Scratch`/`walkChain` scratch machinery only they used. Every caller reads the bit
  planes now; the stone-walk implementations that remain are the *reference* ones in
  `analysis.cpp`, which `mcgs` still uses and `selftest` compares against.
- `blackPlayoutLegal`, `playToMove`, `findOrAddChild`, `findChildIndex` in `mcgs.cpp`.
- `EndgameInfo::whiteCaptures` and the per-point work that filled it: only the
  removed endgame approximation read it, so `analyzeEndgame` now answers just the two
  questions its remaining caller asks. `ChainList::toVector()` went the same way with
  `neighborChainIndices`.

Removed because they were legacy behaviour behind a comparison switch:

- `IPVGO_ENDGAME_APPROX` and the approximation body of the endgame White model,
  together with `endgameCaptureChance()` and `ExploitConfig::endgameExactWhite`. The
  endgame always uses the real reply distribution; the measurements are kept under
  "Known limits and open questions".
- `IPVGO_NO_MEMO`, the transposition-table off switch. Its numbers are kept in
  "Known limits" so the table's cost does not have to be re-derived.
- `IPVGO_ADAPTIVE_DEBUG`, a `fprintf` left in the iterative-deepening setup.

Switches that stay are configuration, not alternatives: `IPVGO_NODE_LIMIT`,
`IPVGO_THREADS`, `IPVGO_CARRY`, `IPVGO_NO_SESSION`, `IPVGO_PONDER_*`, `IPVGO_TRACE*`,
`IPVGO_EXPLAIN`, `IPVGO_CACHE_STATS`, `IPVGO_FIXED_WIDTH`, `IPVGO_WHITE_WORST`,
`IPVGO_DETERMINISTIC` / `IPVGO_DYNAMIC` (see "The threading pass") and the evaluation
knobs (`IPVGO_SETTLE`, `IPVGO_VITAL`, `IPVGO_EYE_FILTER`, `IPVGO_MOYO*`).

Verified after the removal, with the usual suite: `selftest`, `fuzz 60 11` (6874
moves, 0 anomalies), `policycheck` identical on three factions, `eyetest` unchanged
(49 041 / 38 652 / 0 mismatches), `optbench` node counts 39 012 and 11 537, and
identical `exploitplay` results at 5x5, 7x7, 9x9, 13x13 and 19x19 (wins, margin,
depth, ponder hits). Interleaved against a build of the pre-pass commit, 5 rounds:
-3.6% on the 2-position bench (199.2 -> 192.0 ms) and -2.2% on the 9x9 bench
(82.2 -> 80.3 ms), the same place the move-generation pass left off.

### The profile-guided optimisation experiment

The last cheap idea was to let the compiler see where the engine really spends its
time instead of guessing: profile-guided optimisation, trained on the search itself.
It does not pay here, and the reason matters for future work, so both the plumbing and
the numbers stay.

```powershell
.\cmake\Build-Pgo.ps1           # instrument, train on play, relink optimised
.\cmake\Build-Pgo.ps1 -Games 8  # more training games
```

`IPVGO_PGO` (OFF / GENERATE / OPTIMIZE) in `cmake/BuildTypes.cmake` holds the flags;
`cmake/Build-Pgo.ps1` drives the two passes over `out/build/x64-Pgo`. The training
workload is what the game asks for - a 4 000-node budget per move, deterministic,
across 5x5 to 19x19 and several factions - so the profile is reproducible and matches
the distribution the engine is optimised for.

Three things have to be right, and each of them fails quietly:

- `/GENPROFILE` and `/USEPROFILE` are **linker** options. Passed to `cl.exe` they only
  earn D9002 ("ignoring unknown option"), the binary stays uninstrumented and the
  profile arrives with zero counts. Instrument with `/LTCG:PGINSTRUMENT /PGD:<path>`
  and optimise with `/LTCG:PGOPTIMIZE /PGD:<path>`; both imply `/LTCG`, so the plain
  flag is dropped first to avoid D9025.
- The instrumented binary needs `pgort140.dll`, which ships in the toolset's `bin`
  directory and is not part of the redistributable. Off `PATH` it exits with
  0xC0000135 (STATUS_DLL_NOT_FOUND) before recording anything - and because the
  training loop pipes its output, that looks exactly like a successful run.
- The counters land as `ipvgo!N.pgc` **next to the executable**, not in the working
  directory. Merge them with `pgomgr /merge ipvgo.pgd ipvgo!*.pgc` and require
  `pgomgr /summary ipvgo.pgd` to report `Dynamic instructions` above zero before
  trusting the optimised build; otherwise the optimiser links an empty profile and
  changes nothing.

Measured against the Release build from a profile of 2.9e12 dynamic instructions,
interleaved, six rounds on the benches and three on the play rows:

| workload | Release | PGO | delta |
|----------|---------|-----|-------|
| 2-position bench, depth 3 (39 012 nodes) | 172.3 ms | 175.2 ms | +1.7% |
| 9x9 bench (11 537 nodes) | 64.7 ms | 66.0 ms | +1.9% |
| play, 40 000 nodes per move, 1 thread, Slum Snakes 9x9 | 108.3 ms | 108.8 ms | +0.5% |
| play, same budget, Netburners 7x7 | 73.1 ms | 72.7 ms | -0.6% |

Node counts are identical (39 012 and 11 537) and `selftest`, `fuzz 60 11` and
`eyetest` give the same results as Release, so the profile only changes code layout.
It does shrink the image: 567 KB of code becomes 425 KB.

The regression on the fixed-depth benches is the interesting part. Play never reaches
those deeper search paths under a 4 000-node budget, so the profile tells the compiler
they are cold and it stops inlining into them. Training on the benches instead would
invert that, but then the numbers would only measure the fit to their own training
set. On the workload the game actually runs, PGO is neutral: these inner loops are
branch-light and dominated by code that `/GL` already inlines across translation
units, which is the case profile data has least to add to. The default therefore stays
`/O2 /GL /LTCG /arch:AVX2`. Worth repeating only after a large structural change, not
after another tuned micro-optimisation.

### Third-party code

`third_party/ankerl/` holds [ankerl::unordered_dense](https://github.com/martinus/unordered_dense)
v4.8.1 (MIT), vendored as headers so the build needs no network access.

### Parity checks

Changes to the rules, the board representation or the caches must keep these
identical, not merely similar:

```bash
./out/build/x64-Release/bin/ipvgo_game selftest          # bitwise-capture and make/unmake oracles
./out/build/x64-Release/bin/ipvgo_game fuzz 60 11        # expect 6874 moves, 0 anomalies
./out/build/x64-Release/bin/ipvgo_game policycheck "The Black Hand" 5 800
./out/build/x64-Release/bin/ipvgo_game eyetest 8 7       # incremental eye totals vs the full analysis
# per-move trace, including values and node counts:
IPVGO_NO_SESSION=1 IPVGO_TRACE=1 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Slum Snakes" 5 2 2 1
```

`eyetest` prints how many candidate points the incremental path answered and how
many it declined, so a change that quietly turns the fast path off is visible.

`selftest` also covers the chain arrays themselves: a 19x19 checkerboard is the worst
case for the liberty storage, and the check fails if a listed liberty is not an empty
neighbour or if the totals outgrow the fixed arrays.

`optbench` runs the deterministic scheduler, so its node counts repeat exactly at any
thread count (the count itself differs a little between thread counts, because the
workers' memo partitions differ - `--threads=1` gives the reference 39 012 / 11 537).
Compare like with like: same `--threads`, same configuration. The search has no
value-based pruning, so node counts do not depend on the eval - only the reported
`value` and the chosen move do.

`IPVGO_NODE_LIMIT` makes `exploitplay` search the way the server does (the client
sends `iterations`, which becomes a node budget and switches on iterative
deepening, so the `depth` argument stops applying):

```bash
# the configuration the game actually runs, at 5x5 and 9x9
IPVGO_NODE_LIMIT=4000 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Illuminati" 5 25 2 1
IPVGO_NODE_LIMIT=4000 ./out/build/x64-Release/bin/ipvgo_game exploitplay "Illuminati" 9 4 2 1
```

Two knobs genuinely change which moves are played, and are therefore not
regression-tested:

- **`nodeBudget`** caps the endgame solve using a per-search node counter, so a
  position's value depends on how many nodes the search visited before reaching
  it. Changing the budget (or the thread count, since each worker gets its own
  counter and a partition of the root moves) can change the chosen move. The default
  scheduler claims root moves dynamically, so even at a fixed budget and thread count
  the play varies slightly run to run; set `IPVGO_DETERMINISTIC=1` (or build a tool,
  which sets it) to pin the round-robin split and get the same moves every time.
- **The session cache** reuses positions across moves. It only reuses values with
  no endgame cut in their subtree, so reuse cannot lower accuracy, but it does
  change which nodes get evaluated and therefore the play.

A third does too, though deliberately: **`adaptiveWidth`** decides the beam and
the reply count from the budget and the measured concentration of White's policy,
so the depth actually reached depends on both.

### Known limits and open questions

Recorded so they are not rediscovered from scratch. Every number here was
measured, not estimated.

**The reported `p(win)` collapse is mostly the value not being one series
(measured: 5x5, 240 games).** Setup: `benchjson` with the in-game node budget
(`iterations=1000`, what `src/ipvgo.ts` sends), seed 1, 40 games per faction,
deterministic round-robin threads: 208/240 = 86.7% wins, 2921 Black moves. The
bench now records, per half-move, what the leaf evaluator thought (`audit.root`,
`audit.after`, `whiteAudit.after`), the top three root alternatives, the modelled
probability of the reply White actually played, and `audit.flat` — the same value
from a fixed one-ply search, which therefore means the same thing on every move.

- **The reply model is not the cause.** 119 moves dropped more than 0.15 against
  the next one. All 119 had White's actual reply inside the modelled set, at a
  median modelled probability of 1.000 (minimum 0.042).
- **Nor is there one cause per drop.** 47 of the 119 are the leaf itself flipping
  (the next value is within 0.1 of the leaf after White's reply), 40 are the next
  search coming out below that leaf — it found a refutation — and 32 are above it.
- **The value is a depth-varying quantity.** Mean reported value by the depth the
  search actually reached: 0.55 at depth 1, 0.54 at 2, 0.69 at 3, 0.77 at 4, 0.71
  at 5, 0.60 at 6, 0.52 at 7, then 0.05, 0.03 and 0.002 at depths 8-10 (those are
  the exact endgame solve, which is a different, much more accurate estimator).
  A move searched to depth 4 and the next one to depth 1 differ by about 0.2 for
  no reason but the budget, which is why consecutive numbers are not comparable.
- **On a comparable series the blunders mostly disappear.** The same threshold on
  `flat` flags 41 drops, and only 6 of them are among the 119: 113 of the 119 are
  not the position getting worse. Mean absolute change between moves is 0.0755 on
  the search value and 0.0697 on the fixed-depth one, but the *large* changes are
  concentrated in the first.
- **Losses do have real swings.** 20 of the 32 losses contain at least one
  fixed-depth drop above 0.15; the other 12 lose without a single jump ("the slow
  bleed").
- **A White pass does not move the value by itself.** 8 of the 119 drops follow a
  pass: 4 are `depth 3 -> 1`, where the next value returns to the leaf, and 4 are
  the endgame solve firing (depth 5-8 in a handful of nodes, and those games were
  all lost). The pass is the occasion, not the cause.
- **`p(win) = 1.000` is a cap.** 249 of 2921 moves (8.5%) reported exactly 1.000
  and 137 (4.7%) at or below 0.001. None of the 1.000s was in a game Black lost in
  this capture, but the eval lead of those roots ran from -9.4 to +22.5 and the
  rules lead from -7.5 to +22.5 — a position the game's own score calls lost can
  still be reported as certain, because the atari terms and the face-value region
  credit saturate the logistic.

The two mechanisms behind those numbers are the ones already on this page: the
search is at depth 1-2 for most in-game moves, so `value` is close to the leaf,
and the leaf credits empty space bordered by one colour at face value, so its
verdict flips when White walks into that space (ten measured variants, none
better — see below). Neither is a term that can be fixed by editing one
coefficient, so the eval was left alone and the *reporting* was fixed instead:
`flat` is emitted next to `value`, the GUI marks `BLUNDER` (search series) apart
from `SWING` (fixed-depth series) and `CAPPED`, and the explanation says which of
the two a drop is. Re-running this capture on the instrumented build reproduced
all 240 results and all 2921 moves exactly, so none of that changes play.

For the record, the calibration of the eval's own `p(win)` over the same 3161
half-moves (bucket -> actual win rate of the game): 0.0-0.2 -> 8.7% (368 moves),
0.2-0.4 -> 75.2% (876), 0.4-0.5 -> 90.9% (832), 0.5-0.6 -> 88.5% (471),
0.6-0.7 -> 94.6% (186), 0.7 and up -> 100% (188). It is deliberately
*under*-confident in the middle band — the logistic's centre sits at a zero lead
so that "we are stronger than this faction" is not baked in — and that is the
design decision recorded in the source, not a bug to fit away.

**The dominant loss signature on small boards is a total wipe-out, and the eval
cannot see it coming.** Traced Netburners 7x7 at the in-game budget (`IPVGO_EXPLAIN=1`,
seed 2): every loss ends with Black at 0 points after 46-59 moves, against 16-26
moves in the games Black wins. In one such game Black's groups stayed at 1-5
stones while White's single group grew monotonically 3 -> 23 stones; the eval
reported a rising win probability throughout, because a stone is worth the same
wherever it is played. By the time White's group was in atari at 22 stones Black
had no surrounding stones left to fill the last two liberties, and the eval
credited that threat 2.1 points when a capture that size is worth about 40.

Three things measured from the same trace:

- **The eval is almost flat across Black's options.** For the first 22 moves the
  gap between the chosen move and the runner-up was +0.000 to +0.005 in win
  probability, so selection is effectively decided by action order. A search
  cannot fix a leaf that will not rank.
- **Raising the atari weight cap does not fix it.** Crediting a 20-stone group at
  full size instead of capping at 5 stones: 7x7 Netburners 164/180 vs 161/180,
  and 5x5 all factions 192/240 vs 196/240 - both inside the noise. The
  misvaluation is real but it is not the binding constraint.
- **The reply model is not the problem.** White's actual move had modelled
  probability 0.87-1.00 in the endgame and 0.92 on the key midgame moves; the
  worst miss in a whole game was a 0.4% move. We knew what White would do.

What the eval has no term for is the thing that decides these games: a capturing
race between a big group with few liberties and the scattered groups surrounding
it. Without it, more depth does not help either - at 7x7 the search already
reaches depth 2 inside the budget.

**Static safety analysis is implemented and correct, but none of its uses paid.**
`cpp/game/safety.{hpp,cpp}` implements Benson's pass-alive algorithm for both
colours (Benson, Information Sciences 10:17-29, 1976) plus a Vital level - "alive
if the defender answers in its own region" - computed exactly by letting the
defender play a point and re-running Benson, rather than with Fuego's static
predicate, whose exact form could not be verified from a primary source. Six
selftest cases cover two real eyes (pass-alive), one eye (not), a 2x2 eye space
(a false eye, correctly not alive) and scattered stones (neither colour).
`ipvgo_game safety <req.json>` prints the per-chain verdict, the rules score and
the safety-discounted eval.

Three uses were measured on 7x7 Netburners, 120 games per arm, baseline
109/120 = 90.8%:

| use | result | cost |
|---|---|---|
| credit only secured regions, unsettled space at 0.5 | 106/120 (88.3%) | +35% |
| same at 0.0, so only proved territory counts | 106/120 (88.3%) | +77% |
| the Vital level instead of Benson alone | 102/120 (85.0%) | +70% |
| never play inside our own pass-alive eye | 105/120 (87.5%) | +6% |

All within about 1.5 sigma of each other and all pointing the same way, so all
three ship off and the evaluator is unchanged by default. The diagnosis behind
them is still right - the old eval read +9.1 where the game was lost by 46, and on
the exact failing board the discounted eval moves from +9.14 to +3.64. But knowing
a point is unsettled does not tell the search which move to play, and it costs a
gradient the eval was using to tell moves apart. What is still missing is
influence: Black scatters stones while White builds one group, and no life/death
term prices that.

**The evaluator is a local optimum: ten variants, none better.** Measured on 7x7
Netburners, 120 games per arm, baseline 109/120 = 90.8%. Everything tried either
matched it within noise or lost:

| change | wins | ms/move |
|---|---|---|
| baseline (area score + atari terms) | **109** | 96 |
| discount unsettled territory to 0.5 | 106 | 130 |
| discount it to 0.0 | 106 | 170 |
| Vital level instead of Benson alone | 102 | 165 |
| skip moves inside our own eye | 105 | 106 |
| influence moyo points, weight 0.5 | 106 | 98 |
| influence moyo points, weight 1.0 | 96 | 95 |
| influence moyo, 9 iterations | 105 | 103 |
| (earlier) territory discount by region size | 192/240 vs 196/240 on 5x5 | - |
| (earlier) full size atari weighting | 164/180 vs 161/180 | - |

The reason is worth recording: **the game's own score is area scoring**, so
`getScore` is literally the win condition, and "what would the score be if the game
ended now" correlates with the result better than any story we can tell about the
future. Every attempt to correct it replaces a direct measurement of the objective
with a judgement about it, and our judgements measured worse. Note this is not an
argument that the eval is right - it demonstrably reads +9 where the game is lost
by 46 - only that nothing tried so far beats it.

That shifts the remaining 9% of losses from the evaluator to the search: at depth 1
in game, no eval can see a group being captured two moves later. The measurable
lever is per-node cost (pattern matching is ~58% of exclusive time), which buys
depth without a win-rate experiment.

**The endgame used a stand-in for White's policy, and it was wrong.** Positions with
fewer than endgameEmpties empty points took a different branch that never called
opponentReplyDistribution: it assumed White captures at the faction's capture rate
and spreads the rest uniformly over the remaining points. That is an approximation
of a policy we model exactly, applied in the phase where games are decided.

Measured on one losing position (Netburners 7x7, 4 empty points): the exact
distribution gave White a 0.9-probability reply whose child was worth 0.01, the
stand-in returned 0.46 for the same node, and the game went on to lose by 46. With
the exact model the same node reads 0.10 in 168 nodes instead of 0.46 in 603 -
more accurate and cheaper, because the endgame has few legal replies.

Over games, 7x7 Netburners at depth 2, 40 games per arm: 31/40 with the stand-in,
35/40 with the exact model, and 32 ms/move down to 18. 9x9 showed the same
direction (9/12 vs 10/12). The stand-in and the switch that could bring it back
have since been removed.

**Bouzy's dilation measures reach, not strength.** `cpp/game/influence.cpp`
implements the numeric dilation `Dz` (IJPRAI 17(2):257-268, 2003) and is tested,
but it does not distinguish a connected group from the same stones scattered: both
reach about as far and peak at the same value. The hypothesis that influence would
price "Black scatters while White connects" was wrong, and the weight-1.0 arm above
(80.0%, 2.6 sigma worse) is what that costs. It is kept because the map is useful
for inspecting positions (`IPVGO_INFLUENCE_MAP=1` with `ipvgo_game safety`), not
because it helps the eval.

**Win rate at 9x9 cannot resolve small changes, so do not screen there.** The
same binary won 54.2% of one 24-game set and 79.2% of another (different seeds),
so the standard error on a 9x9 arm of that size is about 10 percentage points.
Roughly 250 games per arm are needed to detect a 5-point change, which is about
an hour of search per arm. Screen on 5x5, where 240 games gives +/- 2.6 points,
and treat 9x9 as confirmation only. `tools/sweep.ps1` runs a set and pools seeds,
and prints the standard error so an effect can be compared against it.

**Four eval/search ideas were tried and none survived that bar.** With the
in-game node budget and 5x5 x 240 games per arm (baseline 81.9% +/- 1.4 over 720
games, stable across seeds: 81.7 / 81.7 / 82.5):

| change | result | verdict |
|---|---|---|
| discount open regions by size (invasion risk) | 80.0% at 0.10, 75.4% at 0.20 | 0.20 is a real regression (~2.4 sigma); 0.10 is neutral |
| prioritise moves that save a 2-4 liberty group | identical to baseline | no effect: on 5x5 the 12-move beam rarely binds, so the ordering is never used |
| rank all root moves by leaf, search the top N deeply | 8x fewer nodes at 9x9 depth 2 (4 891 -> 611) | no strength change (32/48 vs 32/48 pooled); cannot reach depth 3 in budget |
| higher beam / more replies | not pursued | cost grows as the branching factor per ply |

A discount fitted on 9x9 alone looked like +20.8 points and reversed sign on the
next seed, which is the trap the power note above is about.

**Full-width search is not an alternative to the beam - at the affordable depth
it is already what happens.** At depth 1 the root is every legal move already:
forcing the interior and the root to full width changed the node count by
exactly zero and picked the same move on 5x5, 9x9 and 13x13 (20 / 68 / 129
nodes). The search is at depth 1 in game, so "search all moves to a depth" is
what it already does; what it lacks is a second ply.

Beyond depth 1 full width costs board area squared per ply and is out of reach.
Measured on one 9x9 position, threads=1:

| | depth 1 | depth 2 | depth 3 |
|---|---|---|---|
| beam 12 / 6 replies | 68 nodes, 37 ms | 4 891 nodes, 1.8 s | 179 796 nodes, 70 s |
| full width | 68 nodes, 38 ms | 262 170 nodes, 144 s | not reachable |

Extra depth costs ~3 855x per ply at full width and ~72x with the beam, so the
beam is not a heuristic that loses moves: it converts the same node budget into
two more plies, and two more plies is what flipped the 9x9 loss analysed in
`IPVGO_TRACE_BOARD` (depth 1 and 2 lost it by -81.5 with identical moves, depth 3
won it by +8.5). The legitimate worry about the candidate set is *interior*
moves, which are contact points only, so a distant vital point is never
evaluated - that argues for widening the beam or always including forcing and
defensive moves, not for removing the beam.

**The endgame node budget is load-bearing.** `nodeBudget` (30 000) stops the
exact endgame solve once a search has visited that many nodes. It looks like a
safety valve that could be replaced by a structural bound; it is not that simple.
Setting it out of reach took a 4-game Netburners match from 592 880 to
2 797 516 nodes (4.7x). The reason a "≤ 6 empty points, so it ends in 6 moves"
argument fails: **captures re-open points**, so the play-out can run far longer
than the empty count suggests. Any replacement bound has to cope with that.

**Budgets are per search, not per branch.** `nodes_` is cumulative for a whole
`searchRoot` call, and each worker thread gets its own counter over a partition
of the root moves. So the effective budget - and occasionally the chosen move -
depends on the thread count. Budgeting per root branch would make the adaptivity
measure a branch's own difficulty instead of the order it happened to be visited
in. Not done; it is a small change but it moves the accepted baseline again.

**Most cross-move reuse is still blocked by the memo key.** Cross-move hits were
only 1.5-5% of memo lookups, because `positionKey()` hashes
`previousBoards.size()`, which changes every move - the same board at move N and
move N+1 can never share a key. Keying on the board plus the single previous
board (enough for the ko rule) would unlock a lot more, but raises a soundness
question wherever superko actually binds.

**The transposition table is a hash map, not a tree, and it is not free.**
A temporary switch that turned the table off in the same binary separated its cost
from its value; it was removed with the rest of the legacy branches (see "The
cleanup pass"), and these are the numbers it produced. In-game budget, one thread:

| board | with the table | table off |
|---|---|---|
| 5x5 Netburners, 8 games | 71 849 nodes, 731 ms | 72 828 nodes, 947 ms |
| 7x7 Slum Snakes, 4 games | 129 595 nodes, 3 030 ms | 142 133 nodes, 2 983 ms |
| 9x9 Illuminati, 2 games | 169 705 nodes, 3 731 ms | 141 562 nodes, 3 211 ms |
| 13x13 Illuminati, 1 game | 152 856 nodes, 15 463 ms | 150 661 nodes, 13 856 ms |

Where it pays, it pays for transpositions: at 5x5 the endgame play-out reaches the
same position through many move orders, the hit rate is 5.8% and the table is worth
23%. At 9x9 and 13x13 it *costs*, for an indirect reason - an iteration that hits
the memo visits fewer nodes, and the iterative-deepening heuristic reads the node
counts to predict the next depth, so cheaper iterations talk it into attempting a
depth that then overshoots the budget and is discarded. That work is spent without
being kept. The hit rate itself is only 1.3-3% there, so the key hashing (one FNV
step per board cell plus up to four history boards, on every node) is not repaid.

A pointer tree - a node per move with parent/child links - is the wrong fix for
this. It cannot serve a transposition at all: the same position reached by two move
orders becomes two nodes, where the hash gives it one entry, so it would *increase*
both memory (roughly 48-64 bytes per node against 32 per memo entry, and a node per
distinct path rather than per distinct position) and search time. What a tree could
do that the hash cannot is keep the subtree under the opponent's actual reply, which
is path-based reuse; the session memo already provides that by key, and strictly
more of it. The idea worth pursuing instead is a cheaper key - one hash of the
packed 2-bit board rather than a per-cell loop - so the cost side of the trade
above shrinks. An earlier attempt did that and changed budgeted node counts, which
is still unexplained, so it has to be resolved before it can ship.

**Reuse has no strength measurement.** The 24-game comparison plays *different*
games in each mode, so the win counts are not comparable (18/24 vs 19/24 is
noise, not a regression). Whether reuse helps or hurts win rate needs a fixed
configuration and roughly 100+ games per faction.

**The policy model is the search, and its cost is now spread out.** On a 7x7 game
at the in-game budget `opponentReplyDistribution` is 75% of the search and
`buildPolicyModel` 46% of that, but inside it no single item dominates:
`getEyeCreationMoves` is 26%, the liberty queries behind `surround` and `growth`
about 10%, and the eye-blocking pass 13%. Read those shares from a profile built
with `-ProfileInlining`; the default profile configuration disables inlining, which
inflates exactly this kind of call-heavy code and made the eye pass look twice as
expensive as it is in Release.

`matchesAnyPattern` is 4.8% of exclusive samples in that build, and 1.5% in the
no-inlining one. The ~58% figure in the older notes predates the bitset rewrite.

Reply distributions are reused within one search (see "The reply-reuse pass")
but not across moves: on 13x13 keeping them for a whole game cost 872 MB for 89
hits, and cross-move memo hits are only 1.5-9% because `positionKey()` hashes the
history size.

The HTTP server also exposes the exploiter for real games with
`IPVGO_ENGINE=exploit` (POST `/api/ipvgo/move`, engine reported as `exploit`,
native MCTS as fallback). `exploitmove` accepts `depth`, `beam`,
`whiteChildren`, `whiteMass`, `endgameEmpties`, `nodeBudget`, `threads`,
`budgetMs` (wall-clock iterative deepening) and `iterations`/`nodeLimit` (node
budget; the in-game client's `iterations` field is used as the node budget).

### Persistent engine (`serve`)

`exploitmove` starts a fresh process per move, so the search state - and every
position already solved - is thrown away each move. `ipvgo_game serve` keeps one
process alive and speaks newline-delimited JSON: one request per stdin line, one
response per stdout line. The response echoes an `id` if the request carried one,
and reports `memoHits` / `reusedHits`.

```bash
echo '{"id":1,"board":[".....",".XO..",".XO..",".XO..","....."],"playAs":"X","opponent":"Netburners","depth":2}' \
  | ./out/build/x64-Release/bin/ipvgo_game serve
```

`server.js` uses this for in-game moves: it keeps the engine alive while the same
game (opponent + board size) is being played, recycles it when the game changes,
and falls back to one-shot `exploitmove` if the engine dies.

Reuse is bounded by an accuracy invariant: a memo entry is only kept across
requests when no endgame node-budget cut fired anywhere in its subtree, so a
reused value is always at least as accurate as solving that position again.

The session is one game deep. Every request reports the game's move history
(`ns.go.getMoveHistory()`, which the client already sends so superko can be
checked), and a new game starts that history over, so a request whose history is
shorter than the last one drops the whole cache. That is what keeps memory
bounded - no size ceiling is needed, because nothing survives the end of a game:
measured on the largest board a 13x13 game leaves ~524 000 memo entries (~19 MB),
a 9x9 game ~150 000, a 5x5 game ~12 000. `sessionResets` in the `serve` response
and `resets=` in the stats line report it. The only thing given up is reuse
between games, which is worth little: a different game is a different tree.

The session stores only the memo. Reply distributions are recomputed rather than
cached: on 13x13, keeping them cost 872 MB of `WeightedReply` payload - 98% of
the session - for 89 hits in a whole game. Dropping them took peak RSS from
1 007 MB to 31 MB with identical node counts (524 086) and no measurable change
in think time.
