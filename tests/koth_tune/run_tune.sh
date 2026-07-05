#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXE="$SCRIPT_DIR/build/Release/koth_tune.exe"

# --- edit flags here ---
COUNT=100
SEED=1265595496
DIFFICULTY=60
POPULATION=20
# Leave empty to run until Ctrl+C; set e.g. GENERATIONS=500 for a fixed run.
GENERATIONS=
THREADS=0
MUTATION_RATE=0.35
MACRO_MUTATION=0.08
STAGNATION=12
TOURNAMENT=3
ELITE=2
LOAD="$REPO_ROOT/tests/kingOfTheHillTune.best.json"
OUT="$REPO_ROOT/tests/kingOfTheHillTune.best.json"
# --- end flags ---

if [[ ! -f "$EXE" ]]; then
  echo "Missing $EXE"
  echo "Build: cd tests/koth_tune && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release"
  exit 1
fi

args=(
  --count "$COUNT"
  --seed "$SEED"
  --difficulty "$DIFFICULTY"
  --population "$POPULATION"
  --mutation-rate "$MUTATION_RATE"
  --macro-mutation "$MACRO_MUTATION"
  --stagnation "$STAGNATION"
  --tournament "$TOURNAMENT"
  --elite "$ELITE"
  --load "$LOAD"
  --out "$OUT"
)

if [[ -n "${GENERATIONS:-}" ]]; then
  args+=(--generations "$GENERATIONS")
fi

if [[ "$THREADS" -gt 0 ]]; then
  args+=(--threads "$THREADS")
fi

exec "$EXE" "${args[@]}" "$@"
