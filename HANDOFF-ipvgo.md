# IPvGO engine work: handoff to the WSL agent

Written 2026-11-19 on the Windows machine. Pick up from here. Delete this file once the work is
committed.

## Why this moved to WSL

On the Windows machine, the org's Defender attack surface reduction (ASR) rule `01443614-CD74-433A-B99E-2ECDC07BFC25` blocks every
freshly compiled `.exe`, and local exclusions are ignored. The engine compiled fine there but
could never run. **Nothing below has been executed yet.** All of it compiles (clang-cl), and the
TypeScript passes `tsc`. Validate before trusting any of it.

## The user's brief

- Work on the **main engine only**: the expectimax "exploiter" in
  `ipvgo-engine/cpp/search/exploiter.cpp`. Ignore the playout/MCGS engine (`mcgs.cpp`, `playout*`);
  it is a port of someone else's algorithm.
- Look at the engine's workings, not only at performance.
- The existing docs and comments were written by a weaker model. Don't take their claims
  (measurements, "known limits", why things are off by default) as true without re-checking.
- The user's own repo, no collaborators: branches don't matter much, and committing and pushing is
  fine when asked.

## The big finding: White's RNG is derivable and choosable

The game source is the `stable` branch of bitburner-src. On Windows it was at
`~/dev/bitburner-src`; clone it again in WSL if needed.

- `src/Go/boardAnalysis/goAI.ts` `getMove`:
  - It first does `await waitCycle()`. That sleeps 40 ms while `Go.storedCycles > 0` (bonus
    cycles) and 200 ms otherwise.
  - Then it runs `new WHRNG(Player.totalPlaytime)` and takes 4 draws: isSmart, moveRng (pool
    picks), factionRng (priority branch), fallbackRng.
- `Player.totalPlaytime` only advances in 200 ms engine ticks (`src/engine.tsx`). Scripts can read
  it with `ns.getPlayer().totalPlaytime`.
- So White's reply is a **deterministic function of the tick our move lands in**.
- The one exception is `getDefendMove`'s `Math.random()` tie-break, which is enumerated as
  equally likely options.
- By waiting k ticks, Black can choose among k different White replies.

`ipvgo-engine/cpp/game/rng.hpp` is an exact WHRNG port.

### Unverified assumption

The client assumes these seed timings:
- With bonus cycles, the seed is the current tick's playtime: submit +60 ms, read at +100 ms, same
  tick.
- Without bonus cycles, the seed is the next tick's: read at +260 ms.

Only an in-game run confirms this. The client counts its prediction hits, so watch the dashboard
for `White predicted N/M`.

## What changed (uncommitted)

### Engine bug fixes (`exploiter.cpp`)

1. **Root accepted illegal points.** `afterMove` turned them into a pass, which tied with the real
   pass child and won the stable sort by coming first. The client then played a *random legal
   move* (`pickLegalMove`). Root children now come from `makeMove`, and illegal points are skipped.
   The same fix applies in `whitePolicyConcentrated`.
2. **The beam wasted slots on illegal contact points.** Most factions use beam 2. The new
   `orderedBlackCandidates` returns the full ordering, and `blackToMove` stops after `beam`
   *legal* moves.
3. **`measuredGrowth` was computed once before the deepening loop.** It therefore always equalled
   the nominal value. It is now recomputed per iteration.
4. **A reply that failed to apply lost its probability mass.** That mass now goes to the residual
   (the tail).

### New, behind switches

- **`IPVGO_ORDER=eval`:** orders the beam by the leaf eval after the move instead of the static
  prior. Untested.

### Seed exploit

- `opponents.cpp/.hpp`:
  - `seededReplyDistributions(state, player, opponent, seeds)` returns White's exact reply per
    seed. It shares `resolvePlay` with `getMove`, so the two cannot drift apart.
  - `MoveGen::reseed`, `defendChoices` and `forceDefend` are new helpers.
- `exploiter.hpp`:
  - `ExploitConfig.whiteSeeds` is the list of tick seeds.
  - `ExploitConfig.whiteChoice` is K: the number of ticks Black will be able to pick from at later
    White nodes.
  - `ExploitResult.seedPlan` is the per-tick best move, best first.
- `exploiter.cpp`:
  - `seededWhiteToMove` is the root White node under known seeds. It searches each distinct reply
    once and values the node at its best tick.
  - `Exploiter::bestOfDraws` gives deeper White nodes the expected best of K draws when
    `whiteChoice > 1`.
  - `SeedCache` holds the per-root-move seeded replies across depth iterations.
  - `whiteChoice` is part of the memo key and the session signature.
- `game_cli.cpp`:
  - JSON request fields `whiteSeeds` and `whiteChoice`; response field `seedPlan`.
  - `exploitplay` simulates seed play with `IPVGO_SEED_WINDOW=K`, and optionally
    `IPVGO_SEED_CHOICE`. It prints a `predicted=hits/n` line.
  - New env switches `IPVGO_WHITE_MASS` and `IPVGO_VERIFY_ROOT`.
  - New `seedcheck` command. It plays random games and checks that `getMove` ∈ the seeded replies
    and that the seeded replies ⊆ the policy distribution. Exit code 1 on any mismatch.
  - Ponder: with `expectReply` it searches that reply first. A seeded request is never served from
    a pondered answer.
- Client:
  - `src/libraries/ipvgo/seedTiming.ts` (new) reads the clock, works out seeds from ticks, and has
    `waitForTick`.
  - `src/ipvgo.ts`:
    - `IPVGO_SEARCH.seedTiming: true`, `seedWindow: 10`.
    - Sends the seeds, picks a plan entry, waits for its tick, then submits.
    - Counts hits and turns seed timing off by itself after 6+ predictions below 80%.
    - Passes the predicted reply to the ponder.
  - `engineClient.ts`: `ponderIpvgoEngine(request, move, expectReply?)`.
  - `types.ts`: the new request and response fields.
- Also fixed: `bench/koth/koth_tune/CMakeLists.txt` used the wrong relative path to
  `cmake/BuildTypes.cmake`. It broke configure after the repo cleanup moved the folder.

## Building on Linux

There's no Linux preset; the presets are clang-cl or macOS. The Unix branch of
`cmake/BuildTypes.cmake` handles flags (`-O3 -march=native -flto`).

```bash
sudo apt install -y build-essential clang cmake ninja-build   # if missing
cmake -S . -B out/linux -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=clang++
cmake --build out/linux --target ipvgo_game
ls out/linux/bin/ipvgo_game || find out/linux -name ipvgo_game -type f
```

- `nlohmann/json` is fetched by CMake. If the network blocks it, install `nlohmann-json3-dev`.
- Expect new warnings or errors from gcc/clang that clang-cl tolerated. Fix them minimally.
- Node: use fnm or nvm. The repo's `node_modules` was copied from Windows, so run `pnpm i` in WSL
  (Windows had TLS EPROTO problems with the npm registry; WSL may not).

## Validation plan, in order

Keep a **baseline binary** for A/B comparisons. Build it from the pushed `main`/`ipvgo` commit
(`4ac7487`) in a separate worktree:

```bash
git worktree add ../ipvgo-base 4ac7487
# Apply the koth CMakeLists path fix there too, or configure fails:
sed -i 's#/\.\./\.\./cmake/#/../../../cmake/#' ../ipvgo-base/bench/koth/koth_tune/CMakeLists.txt
cmake -S ../ipvgo-base -B out/base -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=clang++
cmake --build out/base --target ipvgo_game
```

1. **Sanity:**
   - `ipvgo_game selftest`, `ipvgo_game parity`, and the `fuzz` and `eyetest` checks if they're
     quick.
   - Then `ipvgo_game seedcheck 40 1`. It must report 0 misses. A miss means the seeded model and
     `getMove` disagree: fix before anything else.
2. **Bug fixes, baseline vs candidate** (seed play off). `bench/ipvgo/factionBench.mjs` runs all
   six factions at once with the client's per-faction widths, carry on, root verification on and
   10k nodes. That mirrors `src/ipvgo.ts`.
   ```bash
   node bench/ipvgo/factionBench.mjs out/base/bin/ipvgo_game base 40 7
   node bench/ipvgo/factionBench.mjs out/linux/bin/ipvgo_game fixes 40 7
   ```
   Repeat on 5x5: the auto rotation plays 5x5, and Illuminati 5x5 pays the most. Use the same
   seeds for both binaries. 40 games is noisy (±7%), so judge on totals across factions and sizes.
3. **Seed play:**
   ```bash
   node bench/ipvgo/factionBench.mjs out/linux/bin/ipvgo_game seed1 40 7 10000 1 IPVGO_SEED_WINDOW=1
   node bench/ipvgo/factionBench.mjs out/linux/bin/ipvgo_game seed5 40 7 10000 1 IPVGO_SEED_WINDOW=5
   node bench/ipvgo/factionBench.mjs out/linux/bin/ipvgo_game seed10 40 7 10000 1 IPVGO_SEED_WINDOW=10
   ```
   - Window 1 isolates the "exact prediction" gain from the "choice" gain.
   - Also try `IPVGO_SEED_CHOICE=1` with window 10, to see whether best-of-K at deeper nodes helps
     or over-promises.
   - `predicted=` should be close to 100%. Only defend tie-breaks can miss.
4. **`IPVGO_ORDER=eval`** vs the default prior ordering.
5. **Profile and optimise** the exploiter's hot paths. Known suspects:
   - `opponentReplyDistribution` builds two `MoveGen`s per node.
   - `contactPoints`/`blackCandidates` allocate vectors per node.
   - `getAllValidMoves` runs in `blackExploitMoves` at the root.
   - `std::function` in `RoundPool`.

   Use `perf` on Linux.
6. Still open, worth a fresh look:
   - The leaf eval is crude: area count, plus atari terms, through a logistic.
   - The faction profiles in `profileFor` are hand-set.
   - The cheat valuation.
   - Whether `verifyRootReplies` and the per-faction widths are still right once the seed is
     known. With exact replies the root needs no reply width at all.

## Running the real game against WSL

The game runs in the Windows browser and talks to `ipvgo-engine/server.js` over HTTP. Run the
server in WSL with `pnpm run server` (or `pnpm run tools`, which starts it alongside the HTML
tools). WSL2 forwards `localhost`
ports to Windows by default, so the client's URL should keep working. Check the port in
`src/libraries/ipvgo/engineClient.ts` (`getIpvgoEngineUrl`).

`server.js` looks for the engine binary in a list of candidate paths. Make sure the list includes
the Linux build output (`out/linux/bin/ipvgo_game`), or build into a path it already checks. Also
check whether it assumes a `.exe` suffix.

## When done

Report the measured results to the user, with A/B numbers per faction and size. Update
`docs/ipvgo-engine.md` with what was actually measured; don't keep the old unverified claims.
Commit only when the user asks, and include the Copilot co-author trailer.
