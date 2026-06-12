# IPvGO engine (native + WASM + KataGo)

C++ MCTS engine for Bitburner IPvGO. The server prefers **KataGo** (GPU neural net) when installed, with C++ MCTS as fallback.

## Quick start

From the **repo root**:

```bash
pnpm run ipvgo:setup   # download KataGo CUDA binary + neural nets (~200MB)
pnpm run server        # http://localhost:3010
```

In Bitburner:

```bash
run ipvgo.js Netburners 7 8000 auto
```

`ipvgo:setup` downloads:
- KataGo v1.16.5 (CUDA Windows/Linux, OpenCL fallback if CUDA zip fails)
- Main b18 net (5/7/13 boards)
- 9x9 finetuned net (9x9 only)

**First KataGo launch:** OpenCL/CUDA may GPU-autotune for several minutes (cached under `katago/KataGoData/`). The server pre-warms KataGo on startup so tuning finishes before your first in-game move.

Optional native C++ fallback:

```bash
pnpm run ipvgo:build
```

## Engine priority

1. **KataGo** (`ipvgo-engine/katago/`) — GPU analysis engine with pretrained nets
2. **Native** (`ipvgo_engine.exe`) — CPU MCTS if KataGo missing or errors

Force native only: `IPVGO_FORCE_NATIVE=1 pnpm run server`

## Prerequisites

- CMake 3.10+ (native fallback only)
- C++17 compiler (native fallback only)
- NVIDIA GPU + drivers for CUDA KataGo build (RTX series); setup falls back to OpenCL

`nlohmann/json` is fetched automatically via CMake if not installed.

## Native server

VS Code CMake uses **`ipvgo-engine/build`** only.

Server listens on **http://localhost:3010** (`IPVGO_PORT` to override).

- `GET /health` — `{ engine: "katago" | "native" | "missing", ... }`
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

`threads`: `0` = all CPU cores (default), or set an explicit count.
