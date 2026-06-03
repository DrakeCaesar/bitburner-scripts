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
- **Local modules**: Prefer the `@/` alias (e.g. `"@/libraries/connect.js"`) or relative `./` paths. Both are valid in source; see [Viteburner import paths](#viteburner-import-paths) below.
- **Path aliases**: `@/*` and `/src/*` in `vite.config.ts` / `tsconfig.json` resolve to `./src/*` for Vite and TypeScript only. They are **not** game paths.
- **Template reference**: Upstream [viteburner-template](viteburner-template/) files are copied at repo root and in `viteburner-template/`
- **Import extensions**: Imports use `.js` extensions even when importing from `.ts` files (TypeScript compilation requirement). When editing files referenced in imports with `.js` extensions, check for corresponding `.ts` source files first.

#### Viteburner import paths

This section documents a real failure mode: RAM calculation (and runtime imports) breaking with paths like `"/src/libraries/corporation/farmland.ts" does not exist on server: home`.

**Two different roots**

| Context | Root | Example |
|---------|------|---------|
| Repo / Vite / TypeScript | `src/` folder on disk | `src/libraries/corporation/farmland.ts` |
| Bitburner `home` server | No `src/` prefix | `/libraries/corporation/farmland.js` |

`src/` exists only in the repository. viteburner uploads `src/foo.ts` to `@home:/foo.js` (strips the `src/` prefix and `.ts` → `.js`). Anything still pointing at `/src/...` or `*.ts` in **synced** script text is wrong for the game.

**What the pipeline does**

1. You write imports in source (e.g. `@/libraries/foo.js` or `./foo.js`).
2. Vite transforms modules and often emits absolute paths such as `from "/src/libraries/foo.ts"` (`.ts` extension, `/src/` prefix).
3. On upload, viteburner runs `fixImportPath` ([docs](https://github.com/Tanimodori/viteburner/blob/main/docs/guide/transform.md)), which rewrites **only top-level** `import { } from "..."` declarations to game paths like `"/libraries/foo.js"`.
4. It does **not** rewrite:
   - `export { x } from "..."` (re-exports)
   - `export * from "..."`
   - Dynamic `import("...")`
5. Inline sourcemaps (`sourcemap: "inline"`) can also reference original `.ts` paths; RAM calculation may follow those and fail similarly.

**Do not**

- Put `"/src/libraries/..."` in import strings — that is not a path on `home`.
- Rely on path rewrites fixing `export { } from "..."` — use a direct import and export, or import from the module consumers need.
- Assume renaming a source file fixes game errors without a full resync (`u` in viteburner) — stale `.js` on `home` may still reference old paths.
- Use `sourcemap: "inline"` for synced scripts unless you have a specific reason (this repo uses `sourcemap: false` in `viteburner` config).

**Do**

- Use `@/` or relative `./` imports with a `.js` extension in TypeScript source.
- Import constants from the defining module (e.g. `OFFICE_FUND_BUFFER` from `farmland.js`) instead of re-exporting through another file unless necessary.
- Keep dynamic `import()` relative when possible; the `bitburnerImportPaths` plugin in `vite.config.ts` still normalizes `/src/libraries/` → `/libraries/` and `.ts` → `.js` in emitted code for cases viteburner does not fix.
- After changing `vite.config.ts`, **restart** `pnpm run dev`, then press **`u`** for a full upload.
- If debugging, check synced files on `home` (e.g. `libraries/corporation/office.js`) for leftover `/src/` or `.ts` in import/export strings. Remove a stray `home/src/` folder if created during experiments.

**Repo safeguards** (`vite.config.ts`)

- `bitburnerImportPaths` Vite plugin (post-transform): `/src/libraries/` → `/libraries/`, `.ts` → `.js` in module path strings.
- `viteburner.sourcemap: false` to avoid inline maps pointing at `.ts` files during RAM calc.

**Example error**

```
Cannot calculate RAM usage of corporation.js. Reason: "/src/libraries/corporation/farmland.ts" does not exist on server: home
```

Typical causes: unrewritten `export { } from "/src/.../farmland.ts"` in uploaded JS, or dynamic `import("/src/.../farmland.ts")`, often after switching to `@/` without the Vite plugin or before removing re-exports.

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

### In-game UI text

Scripts that render in the game (tail logs, `printRaw`, terminal output, floating windows) should match the game's visual language:

- Use plain ASCII for labels and status text (letters, numbers, basic punctuation)
- Do not use decorative Unicode (arrows, bullets, emoji, box-drawing, fancy dashes, etc.) — they clash with the game's monospace UI
- Prefer styling (background color, font weight) over symbols to indicate state

## Instructions for agents

- **Always consult `NetscriptDefinitions.d.ts` when working with NS API functions** — it contains complete documentation, RAM costs, and type signatures
- Do not run linter, TypeScript checks, or build commands unless explicitly requested by the user
- Do what has been asked; nothing more, nothing less
- Do not create files unless they are absolutely necessary for the goal
- Prefer editing an existing file over creating a new one
