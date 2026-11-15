#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$ROOT/tests/koth_tune"
BUILD_DIR="$ROOT/out/build/x64-Release"

file_mtime() {
  if stat --version &>/dev/null 2>&1; then
    stat -c %Y "$1"
  else
    stat -f %m "$1"
  fi
}

find_exe() {
  local candidates=(
    "$BUILD_DIR/bin/Release/koth_tune.exe"
    "$BUILD_DIR/bin/Release/koth_tune"
    "$BUILD_DIR/bin/koth_tune.exe"
    "$BUILD_DIR/bin/koth_tune"
    "$SRC_DIR/build/Release/koth_tune.exe"
    "$SRC_DIR/build/Release/koth_tune"
    "$SRC_DIR/build/koth_tune.exe"
    "$SRC_DIR/build/koth_tune"
  )
  for exe in "${candidates[@]}"; do
    if [[ -f "$exe" ]]; then
      echo "$exe"
      return 0
    fi
  done
  return 1
}

newest_source_mtime() {
  local newest=0
  local m
  while IFS= read -r -d '' file; do
    m="$(file_mtime "$file")"
    if (( m > newest )); then
      newest=$m
    fi
  done < <(
    find "$SRC_DIR/src" "$SRC_DIR/CMakeLists.txt" "$ROOT/CMakeLists.txt" "$ROOT/CMakeSettings.json" \
      -type f \( -name '*.cpp' -o -name '*.hpp' -o -name 'CMakeLists.txt' -o -name 'CMakeSettings.json' \) \
      -print0 2>/dev/null
  )
  echo "$newest"
}

needs_rebuild() {
  if [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then
    return 0
  fi
  local exe
  if ! exe="$(find_exe)"; then
    return 0
  fi
  local src_mtime exe_mtime
  src_mtime="$(newest_source_mtime)"
  exe_mtime="$(file_mtime "$exe")"
  if (( src_mtime > exe_mtime )); then
    return 0
  fi
  return 1
}

build_tune() {
  if [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then
    cmake -S "$ROOT" -B "$BUILD_DIR" -G Ninja -DCMAKE_BUILD_TYPE=Release
  fi
  cmake --build "$BUILD_DIR" --config Release --target koth_tune
}

FORCE=0
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=1
  else
    ARGS+=("$arg")
  fi
done

if [[ "$FORCE" == "1" ]] || needs_rebuild; then
  echo "Building koth_tune..."
  build_tune
else
  echo "koth_tune is up to date (use --force to rebuild)"
fi

EXE="$(find_exe)"
exec "$EXE" "${ARGS[@]}"
