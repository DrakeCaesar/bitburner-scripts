#!/usr/bin/env bash
# Build ipvgo_game when sources are newer (or missing), then run a command.
#
#   ./scripts/mcgs.sh selftest
#   ./scripts/mcgs.sh mcgsplay Netburners 5 32 10000
#   ./scripts/mcgs.sh bench [size] [games] [playouts] [seed]
#
# Env:
#   IPVGO_BUILD_DIR=build       CMake build directory (default: ipvgo-engine/build)
#   IPVGO_BUILD_TYPE=Release    CMake configuration
#   IPVGO_FORCE_BUILD=1         Always rebuild before run

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${IPVGO_BUILD_DIR:-$ROOT/build}"
BUILD_TYPE="${IPVGO_BUILD_TYPE:-Release}"

FACTIONS_5_13=(Netburners "Slum Snakes" "The Black Hand" Tetrads Daedalus Illuminati)

file_mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

find_exe() {
  local base="$1"
  if [[ -f "${base}.exe" ]]; then
    echo "${base}.exe"
    return 0
  fi
  if [[ -f "$base" ]]; then
    echo "$base"
    return 0
  fi
  return 1
}

resolve_exe() {
  local candidates=(
    "$BUILD_DIR/$BUILD_TYPE/ipvgo_game"
    "$BUILD_DIR/ipvgo_game"
    "$ROOT/build-game/$BUILD_TYPE/ipvgo_game"
    "$ROOT/build-game/ipvgo_game"
  )
  local c exe
  for c in "${candidates[@]}"; do
    if exe="$(find_exe "$c")"; then
      echo "$exe"
      return 0
    fi
  done
  return 1
}

needs_build() {
  local exe="$1"
  if [[ "${IPVGO_FORCE_BUILD:-0}" == "1" ]]; then
    return 0
  fi
  if [[ ! -f "$exe" ]]; then
    return 0
  fi

  local exe_mtime newest=0 m f
  exe_mtime="$(file_mtime "$exe")"
  while IFS= read -r -d '' f; do
    m="$(file_mtime "$f")"
    if (( m > newest )); then newest=$m; fi
  done < <(
    find "$ROOT/cpp" "$ROOT/CMakeLists.txt" -type f \( -name '*.cpp' -o -name '*.hpp' -o -name 'CMakeLists.txt' \) -print0 2>/dev/null || true
  )
  if (( newest > exe_mtime )); then
    return 0
  fi
  return 1
}

build_game() {
  echo "mcgs.sh: configuring $BUILD_DIR ($BUILD_TYPE)"
  cmake -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE="$BUILD_TYPE" "$ROOT"
  echo "mcgs.sh: building ipvgo_game"
  cmake --build "$BUILD_DIR" --config "$BUILD_TYPE" --target ipvgo_game
}

ensure_built() {
  local exe
  if ! exe="$(resolve_exe)" || needs_build "$exe"; then
    build_game
    exe="$(resolve_exe)" || {
      echo "mcgs.sh: ipvgo_game not found after build" >&2
      exit 1
    }
  else
    echo "mcgs.sh: using $exe (up to date)"
  fi
  EXE="$exe"
}

run_bench() {
  local size="${1:-5}" games="${2:-100}" playouts="${3:-10000}" seed="${4:-1}"
  case "$size" in
    5 | 7 | 9 | 13 | 19) ;;
    *)
      echo "bench: size must be 5, 7, 9, 13, or 19" >&2
      exit 2
      ;;
  esac

  local factions=("${FACTIONS_5_13[@]}")
  if [[ "$size" == "19" ]]; then
    factions=(WorldDaemon)
  fi

  echo "bench: size=$size games=$games playouts=$playouts seed=$seed"
  local failed=0 faction
  for faction in "${factions[@]}"; do
    echo ""
    echo "--- $faction ---"
    if ! "$EXE" mcgsplay "$faction" "$size" "$games" "$playouts" "$seed"; then
      failed=$((failed + 1))
    fi
  done

  if [[ "$failed" -eq 0 ]]; then
    echo ""
    echo "bench: PASS (100% all factions)"
    exit 0
  fi
  echo ""
  echo "bench: FAIL ($failed faction(s) below 100%)"
  exit 1
}

usage() {
  echo "usage: mcgs.sh <selftest|fuzz|mcgsplay|bench|...> [args...]" >&2
  echo "       mcgs.sh bench [size] [games] [playouts] [seed]" >&2
  exit 2
}

if [[ $# -lt 1 ]]; then
  usage
fi

CMD="$1"
shift

ensure_built

if [[ "$CMD" == "bench" ]]; then
  run_bench "$@"
fi

exec "$EXE" "$CMD" "$@"
