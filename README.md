# img-to-post

CLI tool: receive images via a Telegram bot, generate posts about them with an
external AI, and save everything in the folder where the tool is invoked.

## Purpose

User sends a meme/photo to a Telegram bot. The tool downloads the image, runs a
configured external AI command with a topic-specific prompt, and writes the
resulting post next to the image in a dated folder inside the working directory.

No AI is bundled. The tool is an **orchestrator**: it delegates content
generation to external CLIs/AIs (e.g. `mycli`, `claude`, `openai`, custom
scripts) via shell commands defined in the config.

## Install (macOS, no Bun/git required)

```
curl -fsSL https://raw.githubusercontent.com/MIt9/img-to-post/main/install.sh | sh
```

Downloads the latest universal binary (arm64+x64) to `~/.local/bin/img-to-post`
and tells you if that's not already on your `PATH`. Then run the setup wizard —
it walks you through everything (creating a Telegram bot, pasting the token,
picking an AI command) with step-by-step instructions, no manual JSON editing:

```
img-to-post setup
```

Prefer to do it by hand? Download the binary from the
[latest release](https://github.com/MIt9/img-to-post/releases/latest) instead:

```
chmod +x img-to-post-macos
xattr -d com.apple.quarantine img-to-post-macos   # macOS blocks unsigned downloads by default
mv img-to-post-macos /usr/local/bin/img-to-post   # optional: put it on PATH
```

Building from source instead (any platform Bun supports): see
[Tech constraints](#tech-constraints) below for the `bun run build` command.

## What the tool must do

1. **Telegram bot** — long-poll `getUpdates`, accept photos/documents, download
   them, write to disk.
2. **Topic routing** — pick a prompt/topic for the incoming image. If the user
   sends a caption matching a topic key (`/tech`, `/ai-news`) use that topic;
   otherwise use `default`. Caption `/all` instead fans out to *every*
   configured topic from the same photo — one download, one queue item per
   topic, one combined Telegram reply when the whole batch finishes.
3. **AI invocation** — run the configured shell command for the chosen
   provider, passing the image path and prompt. Capture stdout as the post.
4. **Save** — create `<cwd>/posts/YYYY-MM-DD_HH-MM/`, copy the image as
   `meme.<ext>`, write each generated variant as `post-1.md`, `post-2.md`, …
   (a topic's `variants` config controls the count, default 1 — always N
   *separate* AI calls, never one call parsed into pieces), and reply to the
   Telegram chat with the saved paths + the first variant's text.
5. **Anti-AI Slop** — built-in automatic prompt enrichment and post-processing
   sanitizer for Ukrainian, English, and other languages. Eliminates AI clichés,
   throat-clearing openers ("Let's dive in", "У сучасному світі"), binary
   contrasts, trailing participle fluff, and formatting spam.
6. **Config** — read `img-to-post.config.json` from the working directory
   (or `--config <path>` / `IMG2POST_CONFIG`). No `.env` support and no
   global fallback directory — config is scoped to the invoking cwd only.
7. **Queue** — incoming Telegram images are appended to a queue persisted as
   `queue.json` in cwd, drained one item at a time by a single sequential
   worker. Restarting resumes exactly where it left off (queue state + the
   Telegram `getUpdates` offset both persist to disk) — no reprocessing, no
   duplicate replies. `img-to-post queue` manages it from a second terminal.

## CLI surface

```
img-to-post bot                     # run the Telegram polling loop (foreground)
img-to-post setup                   # interactive wizard: token, AI command, topic
img-to-post init                    # non-interactive: scaffold config with placeholder values
img-to-post post <image> [topic]    # one-shot: generate post from a local image
img-to-post topics                  # list configured topics
img-to-post queue list              # list queued items and their status
img-to-post queue pause <id>        # prevent a pending item from being picked up
img-to-post queue resume <id>       # make a paused item eligible again
img-to-post queue cancel <id>       # remove an item from the queue entirely
```

## Config schema (`img-to-post.config.json`)

```jsonc
{
  "telegram": {
    "botToken": "123:AA...",          // required for `bot` mode
    "botUsername": "my_post_bot"      // optional
  },
  "defaultTopic": "tech",
  "ai": {
    "default": "mycli",               // provider key used when none specified
    "providers": {
      "mycli": {
        "command": "mycli --pipe --once",   // argv prefix (spread + args below)
        "timeoutSec": 120
      },
      "claude": {
        "command": ["claude", "-p"],
        "timeoutSec": 120
      }
    }
  },
  "topics": {
    "tech": {
      "description": "meme → engineering post",
      "promptFile": "prompts/tech.txt",     // path relative to config file
      "variants": 1,                         // number of separate AI calls -> post-1.md, post-2.md, ...
      "ai": "mycli"                          // optional per-topic provider
    },
    "ai-news": {
      "description": "image → AI news writeup",
      "promptFile": "prompts/ai-news.txt",
      "variants": 1,
      "ai": "mycli"
    }
  }
}
```

Environment variables (lower priority than file, higher than defaults):
`IMG2POST_TELEGRAM_BOT_TOKEN`, `IMG2POST_TELEGRAM_BOT_USERNAME`,
`IMG2POST_AI_DEFAULT`, `IMG2POST_CONFIG` (path override).

## AI invocation contract

For each generation the tool runs:

```
<provider.command> \
  <imagePath> \          # first positional arg
  <promptText>           # second positional arg (or via --prompt if provider declares it)
```

- The command must print the **post text to stdout** and exit 0.
- Exit non-zero → capture stderr, reply `❌ <stderr>` to Telegram, do not save.
- The prompt text may be large; if the AI CLI accepts stdin instead, a provider
  may declare `"stdin": true` and the tool passes the prompt via stdin while the
  image path stays a positional arg.
- `timeoutSec` guards hanging providers.

The tool may set `IMG2POST_IMAGE_PATH` and `IMG2POST_PROMPT` env vars for the
subprocess as an alternative to positional args (both are provided).

## Telegram flow (`bot` mode)

1. Connect, `getMe` → cache username.
2. Long-poll `getUpdates` with `timeout=25`, `allowed_updates=["message"]`.
   Offset persists to `queue.json` after each update, not just in memory.
3. On message with photo/document:
   - Download to `<cwd>/.img-to-post-downloads/` (gitignored).
   - Topic = caption match (`/topic-key`) if present, else `defaultTopic`.
   - Enqueue and reply immediately: `📥 Queued (position N)`.
4. A single sequential worker drains the queue, one item at a time:
   - Reply `⏳ Generating post…`, then run the AI (once per variant).
   - On success: reply `Saved to <dir>\n\n<first variant text>`.
   - On failure: reply `❌ <error>`; nothing is saved.
5. `/start` → friendly usage message. Unknown `/cmd` (no attachment) → list topics.
6. `/stop` → graceful shutdown.
7. Restarting resumes from the persisted queue + offset — no reprocessing,
   no duplicate replies for updates already consumed. A crash-abandoned
   in-flight item is reclaimed back to pending on the next startup.
   Same-cwd concurrent `bot` processes are unsupported (no file locking);
   different working directories are fully isolated instances.

## Output layout

```
<working-dir>/
  img-to-post.config.json
  queue.json                     # persisted queue + Telegram offset (bot mode)
  prompts/
    tech.txt
    ai-news.txt
  posts/
    2026-08-20_08-45/
      meme.jpg
      post-1.md
      post-2.md                  # one file per configured variant
```

Folder name: `YYYY-MM-DD_HH-MM`. If the folder exists, append `-2`, `-3`, …

## Tech constraints

- Runtime: **Bun 1.x** (single-file build via `bun run build`, i.e.
  `bun build src/index.ts --compile --outfile img-to-post` — produces a
  standalone executable, no `bun`/`node_modules` needed on the target).
- TypeScript, strict, `bun run typecheck` (tsc --noEmit) must pass with 0 errors.
- Local imports use an explicit `.ts` extension (Bun resolves this natively;
  deliberate deviation from a Node-oriented `.js`-extension convention).
- Zero runtime dependencies — no bundled AI SDK, no CLI-parsing library
  (`node:util`'s `parseArgs` covers the flag surface). Only `node:*`
  builtins, global `fetch` (Telegram long-poll), and `Bun.spawn` (AI
  subprocess invocation).
- Image type detection from extension: jpg/jpeg/png/gif/webp → mime map.
- Prompt files may contain the full agent prompt (e.g. the "Senior Frontend
  Engineer content agent" prompt) verbatim.

## Tests

94 tests across 13 files, `bun test`. Covers: config load + validation + env
override precedence; topic routing (caption `/tech`, unknown → default);
slug derivation (first line / `SLUG:` prefix / filename fallback); subprocess
invocation (argv, stdout capture, timeout, stdin mode, non-zero exit);
multi-variant generation (N separate calls, all-or-nothing on failure);
output writer (folder-collision `-2`/`-3` suffixing); Telegram update
parsing (photo, document, caption, `/start`, `/stop`, unknown `/cmd`) against
a mocked Bot API; the queue (add/list/next/complete/fail/pause/resume/cancel,
crash-abandoned item reclaim, reload-before-every-operation so a running
`bot` and a `queue` CLI invocation don't clobber each other); the `queue`
CLI command; and an end-to-end path (image in → folder created with image +
post(s) + reply) via fixture AI shell scripts, no live network calls.

## Non-goals

- No own LLM calls; no tool-calling agent loop.
- No video/audio/voice handling (text-only posts from images).
- No webhook server (long-poll only).