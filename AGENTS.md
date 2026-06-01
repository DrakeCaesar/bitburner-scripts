# Agent guide

Context for AI coding assistants working in this repository.

## Common development commands

### Development and file sync

- `pnpm run dev` — Runs **viteburner**, which connects to the game, compiles TypeScript, and syncs scripts with hot reload. **Assume this is always running** — edits in `src/` appear in the game automatically; no manual copy step is needed.

### Code quality

- `pnpm run lint` — Run prettier, eslint, and sort-package-json (auto-fixes)

### Legacy watch scripts

The `watch:*` scripts are an older alternative sync setup (`build/` + bitburner-filesync). The active workflow uses `pnpm run dev` instead.

## Architecture overview

### Bitburner game integration

This repository contains scripts for the Bitburner programming game. Scripts run inside the game environment with the Netscript API. **viteburner** (`pnpm run dev`) keeps the game connected — assume it is running when writing or editing scripts.

### File structure

- `src/` — Source TypeScript/JavaScript entry scripts
- `src/libraries/` — Shared modules (batching, crawling, UI helpers, dashboard, etc.)
- `dist/` — Compiled output (synced to game)
- `build/` — Custom watch/sync tooling (`watch.js`, `init.js`, `config.js`)
- `ideas/discarded/` — Old experiments; not part of the active workflow
- `NetscriptDefinitions.d.ts` — **Complete Bitburner API type definitions (10,000+ lines)**
  - **Always reference this file when using NS functions** to verify signatures, parameters, RAM costs, and return types
  - Contains comprehensive JSDoc documentation for all Netscript API methods

### Module system

- **Netscript import**: Use `import { NS } from "@ns"` for Bitburner API types
- **Local modules**: Use relative paths like `"./libraries/connect.js"` or `"/src/libraries/connect.js"`
- **Path aliases**: `@/*` and `/src/*` resolve to `./src/*`
- **Import extensions**: Imports use `.js` extensions even when importing from `.ts` files (TypeScript compilation requirement). When editing files referenced in imports with `.js` extensions, check for corresponding `.ts` source files first.

### Script entry points

All Bitburner scripts must export a `main` function:

```typescript
import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  // Script logic here
}
```

### Key script categories

- **Hacking automation**: `batch.ts`, `autoNuke.ts`, `analyzeTargets.ts`, `libraries/crawl.ts`, `libraries/batchExecution.ts`
- **Visual enhancements**: `glow.ts`, `scanline.ts`, `libraries/floatingWindow.ts` — UI changes via DOM manipulation
- **Contract solvers**: `contractSolver.ts`, `libraries/contractWorker.ts`
- **Utilities**: Connection helpers, server management, dashboards under `src/libraries/`

### File sync

- **viteburner** (`pnpm run dev`) handles compilation and game sync — treat the game connection as always available
- Source lives in `src/`; compiled output goes to `dist/` and is pushed to the game automatically
- Allowed file types in game: `.js`, `.script`, `.txt`

### Documentation sources

Use the right source depending on what you need:

| Source | When to use |
|--------|-------------|
| [`NetscriptDefinitions.d.ts`](NetscriptDefinitions.d.ts) | API signatures, JSDoc, RAM costs, return types while writing or editing scripts |
| [Bitburner docs (oddiz fork)](https://bitburner-fork-oddiz.readthedocs.io/en/latest/) | Gameplay mechanics, NS2 rules, migrations, and non-API topics |
| Cursor **@Docs** | Add the ReadTheDocs URL above in **Settings → Features → Docs** for semantic search over the full doc site in chat |

For Netscript API work, prefer `NetscriptDefinitions.d.ts` first — it matches this repo and is faster than fetching individual doc pages.

### Development patterns

- Use `eval("document")` and `eval("window")` to access DOM in the game environment
- Import/export works between scripts, but files must be compiled to JavaScript
- Game has RAM costs for script execution — optimize for memory usage
- Scripts can be executed with arguments via `ns.args`

### Testing

- `tests/` directory contains test files
- No formal test runner configured — manual testing in the game environment

### Special considerations

- Game environment restrictions require careful DOM access patterns
- Memory constraints affect script design
- Real-time file syncing enables rapid development iteration
- Visual modification scripts use extensive DOM manipulation and CSS injection

## Instructions for agents

- **Always consult `NetscriptDefinitions.d.ts` when working with NS API functions** — it contains complete documentation, RAM costs, and type signatures
- Do not run linter, TypeScript checks, or build commands unless explicitly requested by the user
- Do what has been asked; nothing more, nothing less
- Do not create files unless they are absolutely necessary for the goal
- Prefer editing an existing file over creating a new one
