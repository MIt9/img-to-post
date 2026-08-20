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

## What the tool must do

1. **Telegram bot** — long-poll `getUpdates`, accept photos/documents, download
   them, write to disk.
2. **Topic routing** — pick a prompt/topic for the incoming image. If the user
   sends a caption matching a topic key (`/tech`, `/ai-news`) use that topic;
   otherwise use `default`.
3. **AI invocation** — run the configured shell command for the chosen
   provider, passing the image path and prompt. Capture stdout as the post.
4. **Save** — create `<cwd>/posts/YYYY-MM-DD_<slug>/`, copy the image as
   `meme.<ext>`, write the post as `<topic>.md` (or `post.md`), and reply to the
   Telegram chat with the saved paths + post text.
5. **Config** — read `img-to-post.config.json` (or `.env`) from the working
   directory; also support a global fallback in `~/.config/img-to-post/`.

## CLI surface

```
img-to-post bot                 # run the Telegram polling loop (foreground)
img-to-post init                # scaffold img-to-post.config.json + prompts/
img-to-post post <image> [topic]  # one-shot: generate post from a local image
img-to-post topics              # list configured topics
img-to-post --once <image>      # alias of `post` for scripting
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
      "outFile": "post.md",                  // filename written in the folder
      "ai": "mycli"                          // optional per-topic provider
    },
    "ai-news": {
      "description": "image → AI news writeup",
      "promptFile": "prompts/ai-news.txt",
      "outFile": "post.md",
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
3. On message with photo/document:
   - Download to `<tmp>/img2post/<chatId>/image-<ts>.<ext>`.
   - Topic = caption match (`/topic-key`) if present, else `defaultTopic`.
   - Reply `⏳ Generating post…` then run AI.
   - On success: reply `📁 <abs paths>\n\n<post>`.
   - On failure: reply `❌ <error>`.
4. `/start` → friendly usage message. Unknown `/cmd` → list topics.
5. `/stop` → graceful shutdown.
6. No duplicate-processing guard required but `getUpdates` offset must persist
   in memory across the run.

## Output layout

```
<working-dir>/
  img-to-post.config.json
  prompts/
    tech.txt
    ai-news.txt
  posts/
    2026-08-20_rsc-learning-curve/
      meme.jpg
      post.md
```

Folder name: `YYYY-MM-DD_<slug>`. Slug is derived from the AI output's first
line if it is a clean slug (`^[A-Za-z0-9][A-Za-z0-9 -]*$`), optionally prefixed
`SLUG:`; otherwise fall back to the sanitized source filename. If the folder
exists, append `-2`, `-3`, …

## Tech constraints

- Runtime: **Bun 1.x** (single-file build via `bun build src/index.ts --compile`).
- TypeScript, strict, `bun run typecheck` (tsc --noEmit) must pass with 0 errors.
- All imports use `.js` extensions (ESM).
- No bundling of AI SDKs — only `node:readline`, `node:child_process` (or
  `Bun.spawn`), `node:fs`, Telegram long-poll via `fetch`.
- Image type detection from extension: jpg/jpeg/png/gif/webp → mime map.
- Prompt files may contain the full agent prompt (e.g. the "Senior Frontend
  Engineer content agent" prompt) verbatim.

## Tests to include

- Config load + env override precedence.
- Topic routing (caption `/tech`, unknown caption → default).
- Slug derivation from AI first line / SLUG: prefix / filename fallback.
- Subprocess call: correct argv, stdout capture, timeout, non-zero exit.
- Telegram update parsing: photo, document, caption, /start, unknown /cmd.
- End-to-end (mocked): image in → folder created with image + post + reply.

## Non-goals

- No own LLM calls; no tool-calling agent loop.
- No video/audio/voice handling (text-only posts from images).
- No webhook server (long-poll only).