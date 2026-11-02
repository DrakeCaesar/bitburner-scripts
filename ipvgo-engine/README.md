# IPvGO engine (exploiter + MCGS)

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
`IPVGO_TRACE=1` prints every move, and `IPVGO_TRACE_BOARD=1` also dumps each
position as JSON so it can be fed straight back to `exploitmove` for deeper
analysis:

```bash
IPVGO_TRACE=1 IPVGO_TRACE_BOARD=1 ./cmake-build/bin/Release/ipvgo_game exploitplay "Slum Snakes" 9 1 2 1
```

`IPVGO_EXPLAIN=1` answers "why did it play that": for every move it prints the
win probability of the chosen move, the next few root alternatives with their
values, the top of the opponent reply distribution White faced, and then what
White actually played with the probability the model gave it:

```bash
IPVGO_EXPLAIN=1 IPVGO_NODE_LIMIT=4000 ./cmake-build/bin/Release/ipvgo_game exploitplay "Netburners" 7 1 2 2
```

The static life analysis has its own command, and three switches (all off by
default because none of them measured a win-rate gain - see "Known limits"):

```bash
./cmake-build/bin/Release/ipvgo_game safety position.json   # per-chain pass-alive verdict
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
IPVGO_CACHE_STATS=1 ./cmake-build/bin/Release/ipvgo_game exploitplay "Netburners" 5 4 2 1
IPVGO_CACHE_STATS=1 IPVGO_NO_SESSION=1 ./cmake-build/bin/Release/ipvgo_game exploitplay "Netburners" 5 4 2 1
```

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

Reference point for optimisation work: **`68813bf`** (dense hash maps, point
masks, make/unmake, session cache). Measure against these numbers, not against
older commits.

Reproduce, from a Release build:

```bash
# Allocation count + time for one fixed search (deterministic node count)
./cmake-build/bin/Release/ipvgo_prof "Slum Snakes" 3 6 1

# Fixed-depth search cost; threads=1 keeps it deterministic
./cmake-build/bin/Release/ipvgo_game optbench --only=all --positions=2 --depth=3 --threads=1 --reps=3
```

| measurement | baseline @ `68813bf` |
|---|---|
| `ipvgo_prof` search (36 290 nodes) | ~290 ms, 940 451 allocations, 20 MB |
| `optbench` per search (2 positions, depth 3) | ~1.6 s (wall clock is noisy; the node counts are the stable part), 68 678 nodes |
| `optbench` position 1 / 2 | 40 847 nodes / 27 831 nodes (node counts are eval-independent), values are win probabilities |
| `exploitplay`, 24 games, depth 2 | 12.7 ms/move with the session, 14.9 ms/move without (1.38M vs 1.78M nodes) |

Largest remaining allocation sites: small `std::vector<int>` growth in the policy
code (~293k / 1.9 MB), `EyeCandidate` vectors (35k), and `PolicyWalker::resolve`
(46k). Nothing large is left; the remaining time is computation, dominated by
`matchesAnyPattern` (~58% of exclusive samples in the depth-3 profile).

Progress for reference, all on the same `ipvgo_prof` workload:

| commit | allocations | bytes | search |
|---|---|---|---|
| `890f71e` | 5.14M | 333 MB | 502 ms |
| `c2bbf26` (board + history + captures) | 3.31M | 166 MB | 383 ms |
| `6da0c4a` (dense hash + masks) | 1.04M | 36 MB | 291 ms |
| `68813bf` (make/unmake + session) | 0.94M | 20 MB | 290 ms |

### Third-party code

`third_party/ankerl/` holds [ankerl::unordered_dense](https://github.com/martinus/unordered_dense)
v4.8.1 (MIT), vendored as headers so the build needs no network access.

### Parity checks

Changes to the rules, the board representation or the caches must keep these
identical, not merely similar:

```bash
./cmake-build/bin/Release/ipvgo_game selftest          # bitwise-capture and make/unmake oracles
./cmake-build/bin/Release/ipvgo_game fuzz 60 11        # expect 6874 moves, 0 anomalies
./cmake-build/bin/Release/ipvgo_game policycheck "The Black Hand" 5 800
# per-move trace, including values and node counts:
IPVGO_NO_SESSION=1 IPVGO_TRACE=1 ./cmake-build/bin/Release/ipvgo_game exploitplay "Slum Snakes" 5 2 2 1
```

`optbench` node counts are deterministic at `--threads=1`; at the default thread
count they vary run to run, so compare node counts only at `--threads=1`. The
search has no value-based pruning, so node counts do not depend on the eval -
only the reported `value` and the chosen move do.

`IPVGO_NODE_LIMIT` makes `exploitplay` search the way the server does (the client
sends `iterations`, which becomes a node budget and switches on iterative
deepening, so the `depth` argument stops applying):

```bash
# the configuration the game actually runs, at 5x5 and 9x9
IPVGO_NODE_LIMIT=4000 ./cmake-build/bin/Release/ipvgo_game exploitplay "Illuminati" 5 25 2 1
IPVGO_NODE_LIMIT=4000 ./cmake-build/bin/Release/ipvgo_game exploitplay "Illuminati" 9 4 2 1
```

Two knobs genuinely change which moves are played, and are therefore not
regression-tested:

- **`nodeBudget`** caps the endgame solve using a per-search node counter, so a
  position's value depends on how many nodes the search visited before reaching
  it. Changing the budget (or the thread count, since each worker gets its own
  counter and a partition of the root moves) can change the chosen move.
- **The session cache** reuses positions across moves. It only reuses values with
  no endgame cut in their subtree, so reuse cannot lower accuracy, but it does
  change which nodes get evaluated and therefore the play.

### Known limits and open questions

Recorded so they are not rediscovered from scratch. Every number here was
measured, not estimated.

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

**Reuse has no strength measurement.** The 24-game comparison plays *different*
games in each mode, so the win counts are not comparable (18/24 vs 19/24 is
noise, not a regression). Whether reuse helps or hurts win rate needs a fixed
configuration and roughly 100+ games per faction.

**The dominant remaining cost is pattern matching.** At depth 3, `matchesAnyPattern`
was ~58% of exclusive samples, reached via `MoveGen::patternPoints` on every
reply-distribution. The patterns are fixed and the board is at most 13x13, so
this is the obvious next target; nothing else in the profile comes close.

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
  | ./cmake-build/bin/Release/ipvgo_game serve
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

