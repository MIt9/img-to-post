# CLAUDE.md — img-to-post

CLI orchestrator for turning images into social media posts via an external AI CLI with built-in anti-slop filtering for Ukrainian and English.

## Build & Test Commands

- **Run tests:** `bun test`
- **Typecheck:** `bun run typecheck` (or `tsc --noEmit`)
- **Build standalone binary:** `bun run build` (produces executable `img-to-post`)

## Architecture & Code Structure

- **[src/index.ts](src/index.ts)** — Main CLI entry point.
- **[src/antislop.ts](src/antislop.ts)** — Anti-AI-slop prompt directives and text sanitizer.
- **[src/bot.ts](src/bot.ts)** — Telegram long-polling bot loop and queue drainer.
- **[src/generate.ts](src/generate.ts)** — Post generation logic.
- **[src/output.ts](src/output.ts)** — Folder writer (`posts/YYYY-MM-DD_HH-MM-SS`).
- **[src/queue.ts](src/queue.ts)** — Queue state management (`queue.json`).
- **[src/ai.ts](src/ai.ts)** — Subprocess launcher for external AI CLIs (`Bun.spawn`).

## Key Guidelines

1. **Zero Runtime Dependencies:** Built strictly on Bun runtime, `node:*` builtins, global `fetch`, and `Bun.spawn`.
2. **Anti-Slop:** Maintain automatic prompt enrichment and output sanitization for Ukrainian & English.
3. **Folder Layout:** Save posts under `posts/YYYY-MM-DD_HH-MM-SS/` (with collision handling `-2`, `-3`).
