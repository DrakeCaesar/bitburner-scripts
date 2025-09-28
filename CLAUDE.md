# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development & File Sync
- `pnpm run dev` - Start viteburner development server with hot reload
- `pnpm run watch` - Start complete watch system (init + transpile + sync)
- `pnpm run watch:remote` - Sync files to Bitburner game via bitburner-filesync
- `pnpm run watch:transpile` - Watch TypeScript compilation only

### Code Quality
- `pnpm run lint` - Run prettier, eslint, and sort-package-json (auto-fixes)

### Build Process
- TypeScript files are compiled with `tsc -w --preserveWatchOutput`
- Custom build system in `build/` directory handles file syncing between `src/` and `dist/`
- Files sync to Bitburner game on port 12525 via bitburner-filesync

## Architecture Overview

### Bitburner Game Integration
This repository contains scripts for the Bitburner programming game. Scripts run inside the game environment with the Netscript API.

### File Structure
- `src/` - Source TypeScript/JavaScript files
- `dist/` - Compiled output (synced to game)
- `build/` - Custom build system (watch.js, init.js, config.js)
- `NetscriptDefinitions.d.ts` - Bitburner API type definitions

### Module System
- **Netscript Import**: Use `import { NS } from "@ns"` for Bitburner API types
- **Local Modules**: Use relative paths like `"./libraries/connect.js"` or `"/src/libraries/connect.js"`
- **Path Aliases**: `@/*` and `/src/*` resolve to `./src/*`
- **Import Extensions**: Imports use `.js` extensions even when importing from `.ts` files (TypeScript compilation requirement). When editing files referenced in imports with `.js` extensions, check for corresponding `.ts` source files first.

### Script Entry Points
All Bitburner scripts must export a `main` function:
```typescript
import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  // Script logic here
}
```

### Key Script Categories
- **Hacking Automation**: `autoHack.js`, `batch.ts`, `crawl.ts` - Core game automation
- **Visual Enhancements**: `glow.ts`, `floatingWindow.ts` - UI modifications using DOM manipulation
- **Contract Solvers**: `contractSolver.ts`, `contractWorker.ts` - Automated puzzle solving
- **Utilities**: Connection helpers, server management, data analysis

### File Sync Configuration
- Allowed file types in game: `.js`, `.script`, `.txt`
- bitburner-filesync config in `filesync.json`
- TypeScript files compile to JavaScript before syncing
- Custom watch system handles TypeScript deletion cleanup

### Development Patterns
- Use `eval("document")` and `eval("window")` to access DOM in game environment
- Import/export works between scripts but files must be compiled to JavaScript
- Game has RAM costs for script execution - optimize for memory usage
- Scripts can be executed with arguments via `ns.args`

### Testing
- `tests/` directory contains test files
- No formal test runner configured - manual testing in game environment

### Special Considerations
- Game environment restrictions require careful DOM access patterns
- Memory constraints affect script design
- Real-time file syncing enables rapid development iteration
- Visual modification scripts use extensive DOM manipulation and CSS injection

## Important Instructions
- NEVER run linter, TypeScript checks, or build commands unless explicitly requested by the User
- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one