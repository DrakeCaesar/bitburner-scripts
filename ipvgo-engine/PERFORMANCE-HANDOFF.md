# IPvGO engine performance handoff

## Goal

Profile the C++ exploiter, identify the dominant current costs, and consider a
larger refactor that increases search throughput. Ground the design in the
profile; compare before and after on a small, repeatable set of games and
positions. Preserve game rules, opponent policy, and default search behavior.

## Get a baseline

From the repository root in PowerShell:

```powershell
.\cmake\Build-Native.ps1 -BuildType RelWithDebInfo -Configure -Target ipvgo_game
.\out\build\x64-Profile\bin\ipvgo_game.exe prof "Slum Snakes" 7 10 4000

.\cmake\Build-Native.ps1 -BuildType Release -Target ipvgo_game
.\out\build\x64-Release\bin\ipvgo_game.exe optbench --size=9 --positions=4 --depth=2 --threads=1 --reps=3
.\out\build\x64-Release\bin\ipvgo_game.exe exploitplay "Slum Snakes" 7 4 3 5

# The second engine, for the same position set. A playout budget replaces the node budget.
# playoutplay and baselineplay share one harness, so their lines are directly comparable:
# baselineplay is the frozen reference the engine was reimplemented from, and the two must
# agree exactly until an improvement is deliberately turned on.
.\out\build\x64-Release\bin\ipvgo_game.exe playoutplay "Slum Snakes" 7 4 10000 1
.\out\build\x64-Release\bin\ipvgo_game.exe baselineplay "Slum Snakes" 7 4 10000 1
```

The profile build disables inlining by default; use its samples to find hot
paths, not to measure Release speed. The script's `-ProfileInlining` option
requires `-Configure`. Visual Studio's CPU profiler can also run
`ipvgo_game profileworkload 5` with the profile configuration. See
[README profiling](./README.md#profiling) for details.

Record the build, commands, environment variables, node counts, moves, values,
wall time and nodes/second. Compare repeated Release runs with the same seeds
and settings; report per-position results as well as aggregate speedup. Profile
again after the change. Older README figures and hotspot claims may be stale.

## Correctness and caveats

- Check `selftest`, `fuzz 60 11`, and `policycheck "The Black Hand" 5 800`;
- For the playout engine, check parity against the original: `node ipvgo-engine/tools/refparity.mjs <reference.js> out/refparity.json 400` then `ipvgo_game refparity out/refparity.json`. It must report zero mismatches in every category.
  compare deterministic single-thread fixed-depth moves, values and node counts.
  Add targeted tests for the refactor and explain intentional differences.
- Carry memo is enabled by default for live server requests (`IPVGO_CARRY=0`
  disables that server default). Earlier fixed-depth multithread results differed
  with carry on and off: claims that it is always identical or safe are **not
  established**. History-dependent endgame memoization, cutoffs and shared
  entries deserve investigation; don't attribute a strength change to an
  optimization without isolating carry and budget effects.
- `benchjson`'s `only` filter uses independently derived seeds, not the original
  shared RNG stream: a matching game number is not an exact replay. Time budgets
  and scheduling can also change the chosen search depth.
- Preserve the existing worktree; don't commit or push without a request. Don't
  run lint or TypeScript checks unless requested.
