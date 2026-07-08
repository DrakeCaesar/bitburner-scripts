#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$ROOT/tests/koth_tune/build"
PRESET="koth-tune-release"

cmake --preset "$PRESET" -S "$ROOT/tests/koth_tune"
cmake --build "$BUILD_DIR" --config Release

EXE="$BUILD_DIR/koth_bench"
if [[ -f "$BUILD_DIR/Release/koth_bench.exe" ]]; then
  EXE="$BUILD_DIR/Release/koth_bench.exe"
elif [[ -f "$BUILD_DIR/Release/koth_bench" ]]; then
  EXE="$BUILD_DIR/Release/koth_bench"
elif [[ -f "$BUILD_DIR/koth_bench.exe" ]]; then
  EXE="$BUILD_DIR/koth_bench.exe"
fi

exec "$EXE" "$@"
