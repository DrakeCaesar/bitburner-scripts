# IPvGO engine (native + WASM)

C++ MCTS engine for Bitburner IPvGO. Same JSON API for:

- **Native** — `server.js` spawns `ipvgo_engine` (fast, for live play)
- **WASM** — `emcc` build for browser workers (optional)

## Prerequisites

- CMake 3.10+
- C++17 compiler (MSVC, clang, or gcc)
- Emscripten (`emcc`) for WASM builds only

`nlohmann/json` is fetched automatically via CMake if not installed (optional: [vcpkg](https://vcpkg.io/) `nlohmann-json`).

## Native server (Bitburner)

Build once, then start the server manually from a terminal (e.g. VS Code).

VS Code CMake is configured (`.vscode/settings.json`) to use **`ipvgo-engine/build`** only — not repo-root `build/` (that folder holds legacy watch scripts).

```bash
cd ipvgo-engine
pnpm run build:native
pnpm run server
```

Or use the VS Code CMake extension: configure/build with source `ipvgo-engine/`.

No npm dependencies — `server.js` uses Node's built-in `http` module only.

Server listens on **http://localhost:3010** (override with `IPVGO_PORT`).

- `GET /health` — engine status
- `POST /api/ipvgo/move` — JSON body from `ns.go`, returns `{ move, iterations, elapsedMs }`

In Bitburner:

```bash
run ipvgo.js Netburners 7 5000 auto engine
```

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
  "validMoves": [[true, false, ...]]
}
```
