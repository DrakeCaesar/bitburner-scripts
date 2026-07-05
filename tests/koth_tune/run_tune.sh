#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXE="$SCRIPT_DIR/build/Release/koth_tune.exe"

# --- edit flags here (counts are multiples of CORES) ---
CORES=12
THREADS=$CORES
POPULATION=$((CORES * 6))   # 72: 6 eval tasks per core per generation
COUNT=$((CORES * 500))       # 600: first N sequential assignments from seed
SEED=1265595496
DIFFICULTY=60
# Fitness target: max or avg (JSON path is derived automatically)
OBJECTIVE=max
# Leave empty to run until Ctrl+C; set e.g. GENERATIONS=500 for a fixed run.
GENERATIONS=
MUTATION_RATE=0.35
MACRO_MUTATION=0.08
STAGNATION=12
RADICAL_STAGNATION=$((CORES * 12))   # 144 gens without improvement -> full random reseed
RADICAL_PERIOD=$((CORES * 4))        # repeat radical reseed every 48 stagnant gens
TOURNAMENT=3
ELITE=4
# --- end flags ---

if [[ ! -f "$EXE" ]]; then
  echo "Missing $EXE"
  echo "Build: cd tests/koth_tune && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release"
  exit 1
fi

if [[ "$OBJECTIVE" != "max" && "$OBJECTIVE" != "avg" ]]; then
  echo "Unknown OBJECTIVE: $OBJECTIVE (use max or avg)"
  exit 1
fi

args=(
  --count "$COUNT"
  --seed "$SEED"
  --difficulty "$DIFFICULTY"
  --population "$POPULATION"
  --threads "$THREADS"
  --objective "$OBJECTIVE"
  --mutation-rate "$MUTATION_RATE"
  --macro-mutation "$MACRO_MUTATION"
  --stagnation "$STAGNATION"
  --radical-stagnation "$RADICAL_STAGNATION"
  --radical-period "$RADICAL_PERIOD"
  --tournament "$TOURNAMENT"
  --elite "$ELITE"
)

if [[ -n "${GENERATIONS:-}" ]]; then
  args+=(--generations "$GENERATIONS")
fi

cd "$(cd "$SCRIPT_DIR/../.." && pwd)"
exec "$EXE" "${args[@]}" "$@"
