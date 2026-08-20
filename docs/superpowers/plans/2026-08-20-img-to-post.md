# img-to-post Implementation Plan

> **For agentic workers:** No subagent-driven-development / executing-plans skill is installed in this environment. Execute this plan directly, task by task, in TDD order (red → green → commit). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bun/TypeScript CLI that runs a Telegram bot, queues incoming images, generates N post-text variants per image via an external AI CLI (orchestrator pattern, no bundled AI SDK), and saves everything under `<cwd>/posts/`.

**Architecture:** Single Bun package, no framework. `src/index.ts` hand-parses `process.argv` (no CLI-parsing dependency — 5 subcommands, small flag surface, native `parseArgs` from `node:util` covers it). Telegram access is plain `fetch` against the Bot API (long-poll `getUpdates`, no MTProto/QR). A `Queue` class persists state to `queue.json` in cwd; the bot loop enqueues on receipt and a single sequential worker drains it, calling the configured AI provider as a subprocess (`Bun.spawn`) once per variant.

**Tech Stack:** Bun 1.x, TypeScript strict, `bun:test`, zero runtime dependencies (all `node:*` builtins + `fetch` + `Bun.spawn`).

---

## File Structure

```
img-to-post/
  src/
    types.ts          # shared types: Config, Topic, QueueItem, ProviderResult
    slug.ts            # slug derivation from AI output / filename fallback
    config.ts           # load + validate img-to-post.config.json, env overrides
    topic-router.ts      # caption -> topic key
    queue.ts             # Queue: persisted state, add/list/pause/resume/cancel, offset
    ai.ts                 # runProvider(): spawn external AI CLI, capture stdout/timeout
    output.ts              # write <cwd>/posts/<date>_<slug>/ (meme + post-N.md), collisions
    telegram.ts              # Bot API client: getMe, getUpdates, sendMessage, downloadFile
    bot.ts                    # orchestrator: poll -> enqueue -> ack -> process -> reply
    help.ts                    # structured --help text
    commands/
      init.ts                   # scaffold config + prompts/
      post.ts                    # one-shot: local image -> post
      topics.ts                  # list configured topics
      queue.ts                   # queue list|pause|resume|cancel
      bot.ts                     # start the bot loop
    index.ts                    # argv dispatch -> commands/*
  tests/
    slug.test.ts
    config.test.ts
    topic-router.test.ts
    queue.test.ts
    ai.test.ts
    output.test.ts
    telegram.test.ts
    e2e.test.ts
  img-to-post.config.json      # created by `init`, not committed (gitignored per-project use)
  package.json
  tsconfig.json
```

Naming note: `src/topic-router.ts` (routing logic) is kept separate from `src/commands/topics.ts` (the `topics` CLI command that lists them) to avoid the collision.

---

## Chunk 1: Project setup, types, slug, config

### Task 0: Bootstrap project

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Init Bun project**

```bash
cd /Users/d.bilukcha/work/img-to-post
bun init -y
git init
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
img-to-post.config.json
posts/
queue.json
*.log
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "build": "bun build src/index.ts --compile --outfile img-to-post"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "chore: bootstrap bun project"
```

---

### Task 1: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write types (no test — pure type declarations)**

```typescript
// src/types.ts
export interface ProviderConfig {
  command: string | string[];
  timeoutSec: number;
  stdin?: boolean;
}

export interface TopicConfig {
  description: string;
  promptFile: string;
  variants: number;
  ai?: string;
}

export interface Config {
  telegram: { botToken: string; botUsername?: string };
  defaultTopic: string;
  ai: { default: string; providers: Record<string, ProviderConfig> };
  topics: Record<string, TopicConfig>;
  configDir: string; // resolved dir the config file lives in, for relative promptFile paths
}

export type QueueStatus = "pending" | "processing" | "completed" | "failed";

export interface QueueItem {
  id: string;
  chatId: number;
  imagePath: string;
  topic: string;
  status: QueueStatus;
  createdAt: string;
  error?: string;
}

export interface ProviderResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared types"
```

---

### Task 2: Slug derivation

**Files:**
- Create: `src/slug.ts`
- Test: `tests/slug.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/slug.test.ts
import { test, expect } from "bun:test";
import { deriveSlug } from "../src/slug.ts";

test("uses clean first line as slug", () => {
  expect(deriveSlug("rsc learning curve\nrest of post...", "meme.jpg")).toBe("rsc-learning-curve");
});

test("strips SLUG: prefix", () => {
  expect(deriveSlug("SLUG: react server components\nbody", "meme.jpg")).toBe("react-server-components");
});

test("falls back to sanitized filename when first line isn't a clean slug", () => {
  expect(deriveSlug("😀 not a slug! full sentence.", "My Meme File.jpg")).toBe("my-meme-file");
});

test("falls back to filename when AI output is empty", () => {
  expect(deriveSlug("", "weird_name!!.png")).toBe("weird-name");
});
```

- [ ] **Step 2: Run, verify fail**

```bash
bun test tests/slug.test.ts
```
Expected: FAIL — `deriveSlug` not defined.

- [ ] **Step 3: Implement**

```typescript
// src/slug.ts
const CLEAN_SLUG = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

function sanitize(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "") // drop extension
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveSlug(aiOutput: string, sourceFilename: string): string {
  const firstLine = (aiOutput.split("\n")[0] ?? "").trim();
  const candidate = firstLine.replace(/^SLUG:\s*/i, "").trim();
  if (candidate && CLEAN_SLUG.test(candidate)) {
    return sanitize(candidate);
  }
  return sanitize(sourceFilename);
}
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test tests/slug.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/slug.ts tests/slug.test.ts
git commit -m "feat: slug derivation from AI output / filename fallback"
```

---

### Task 3: Config loader

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/config.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  delete process.env.IMG2POST_TELEGRAM_BOT_TOKEN;
  delete process.env.IMG2POST_AI_DEFAULT;
});

function writeConfig(obj: unknown) {
  dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const path = join(dir, "img-to-post.config.json");
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

test("loads config from file", () => {
  const path = writeConfig({
    telegram: { botToken: "file-token" },
    defaultTopic: "tech",
    ai: { default: "mycli", providers: { mycli: { command: "mycli", timeoutSec: 60 } } },
    topics: { tech: { description: "d", promptFile: "prompts/tech.txt", variants: 1 } },
  });
  const cfg = loadConfig(path);
  expect(cfg.telegram.botToken).toBe("file-token");
  expect(cfg.defaultTopic).toBe("tech");
});

test("env var overrides file value", () => {
  const path = writeConfig({
    telegram: { botToken: "file-token" },
    defaultTopic: "tech",
    ai: { default: "mycli", providers: { mycli: { command: "mycli", timeoutSec: 60 } } },
    topics: {},
  });
  process.env.IMG2POST_TELEGRAM_BOT_TOKEN = "env-token";
  const cfg = loadConfig(path);
  expect(cfg.telegram.botToken).toBe("env-token");
});

test("defaults topic variants to 1 when omitted", () => {
  const path = writeConfig({
    telegram: { botToken: "t" },
    defaultTopic: "tech",
    ai: { default: "mycli", providers: { mycli: { command: "mycli", timeoutSec: 60 } } },
    topics: { tech: { description: "d", promptFile: "prompts/tech.txt" } },
  });
  const cfg = loadConfig(path);
  expect(cfg.topics.tech!.variants).toBe(1);
});

test("throws when config file missing", () => {
  expect(() => loadConfig("/nonexistent/img-to-post.config.json")).toThrow();
});
```

- [ ] **Step 2: Run, verify fail**

```bash
bun test tests/config.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/config.ts
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Config } from "./types.ts";

const ENV_MAP: Record<string, (c: any, v: string) => void> = {
  IMG2POST_TELEGRAM_BOT_TOKEN: (c, v) => (c.telegram.botToken = v),
  IMG2POST_TELEGRAM_BOT_USERNAME: (c, v) => (c.telegram.botUsername = v),
  IMG2POST_AI_DEFAULT: (c, v) => (c.ai.default = v),
};

export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  raw.configDir = dirname(resolve(configPath));

  for (const topic of Object.values(raw.topics ?? {}) as any[]) {
    topic.variants ??= 1;
  }

  for (const [envKey, apply] of Object.entries(ENV_MAP)) {
    const v = process.env[envKey];
    if (v) apply(raw, v);
  }

  return raw as Config;
}

export function resolveConfigPath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;
  if (process.env.IMG2POST_CONFIG) return process.env.IMG2POST_CONFIG;
  return resolve(process.cwd(), "img-to-post.config.json");
}
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test tests/config.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config loader with env override precedence"
```

---

## Chunk 2: Topic routing, queue, AI invocation, output

### Task 4: Topic router

**Files:**
- Create: `src/topic-router.ts`
- Test: `tests/topic-router.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/topic-router.test.ts
import { test, expect } from "bun:test";
import { routeTopic } from "../src/topic-router.ts";

const topics = { tech: {}, "ai-news": {} } as any;

test("matches caption /tech to topic key", () => {
  expect(routeTopic("/tech check this out", topics, "default")).toBe("tech");
});

test("matches /ai-news", () => {
  expect(routeTopic("/ai-news", topics, "default")).toBe("ai-news");
});

test("falls back to default on unknown caption", () => {
  expect(routeTopic("/unknown", topics, "default")).toBe("default");
});

test("falls back to default on no caption", () => {
  expect(routeTopic(undefined, topics, "default")).toBe("default");
});
```

- [ ] **Step 2: Run, verify fail.**

```bash
bun test tests/topic-router.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/topic-router.ts
export function routeTopic(
  caption: string | undefined,
  topics: Record<string, unknown>,
  defaultTopic: string
): string {
  if (!caption) return defaultTopic;
  const match = caption.trim().match(/^\/([a-z0-9-]+)/i);
  if (match && match[1] in topics) return match[1];
  return defaultTopic;
}
```

- [ ] **Step 4: Run, verify pass. Step 5: Commit**

```bash
git add src/topic-router.ts tests/topic-router.test.ts
git commit -m "feat: caption-based topic routing"
```

---

### Task 5: Queue (persisted, offset, list/pause/resume/cancel)

**Files:**
- Create: `src/queue.ts`
- Test: `tests/queue.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/queue.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "../src/queue.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function newQueue(): Queue {
  dir = mkdtempSync(join(tmpdir(), "img2post-q-"));
  return new Queue(join(dir, "queue.json"));
}

test("add() persists item as pending and writes queue.json", () => {
  const q = newQueue();
  const item = q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  expect(item.status).toBe("pending");
  expect(existsSync(q.path)).toBe(true);
});

test("list() returns items in insertion order", () => {
  const q = newQueue();
  q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  q.add({ chatId: 1, imagePath: "/tmp/b.jpg", topic: "tech" });
  expect(q.list().map((i) => i.imagePath)).toEqual(["/tmp/a.jpg", "/tmp/b.jpg"]);
});

test("next() returns first pending item and marks it processing", () => {
  const q = newQueue();
  const item = q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  const next = q.next();
  expect(next?.id).toBe(item.id);
  expect(q.list()[0]!.status).toBe("processing");
});

test("next() skips paused items", () => {
  const q = newQueue();
  const a = q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  q.add({ chatId: 1, imagePath: "/tmp/b.jpg", topic: "tech" });
  q.pause(a.id);
  const next = q.next();
  expect(next?.imagePath).toBe("/tmp/b.jpg");
});

test("complete() and fail() set terminal status", () => {
  const q = newQueue();
  const a = q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  q.complete(a.id);
  expect(q.list()[0]!.status).toBe("completed");

  const b = q.add({ chatId: 1, imagePath: "/tmp/b.jpg", topic: "tech" });
  q.fail(b.id, "boom");
  const failed = q.list().find((i) => i.id === b.id)!;
  expect(failed.status).toBe("failed");
  expect(failed.error).toBe("boom");
});

test("cancel() removes item", () => {
  const q = newQueue();
  const a = q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  q.cancel(a.id);
  expect(q.list()).toEqual([]);
});

test("state survives reload from disk", () => {
  const q = newQueue();
  q.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  const reloaded = new Queue(q.path);
  expect(reloaded.list()).toHaveLength(1);
});

test("offset getter/setter persists across instances", () => {
  const q = newQueue();
  q.setOffset(42);
  const reloaded = new Queue(q.path);
  expect(reloaded.getOffset()).toBe(42);
});

test("getOffset defaults to 0 for fresh queue", () => {
  const q = newQueue();
  expect(q.getOffset()).toBe(0);
});
```

- [ ] **Step 2: Run, verify fail.**

```bash
bun test tests/queue.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/queue.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { QueueItem, QueueStatus } from "./types.ts";

interface QueueFile {
  offset: number;
  items: QueueItem[];
}

export class Queue {
  path: string;
  private data: QueueFile;

  constructor(path: string) {
    this.path = path;
    this.data = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : { offset: 0, items: [] };
  }

  private persist() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  add(input: { chatId: number; imagePath: string; topic: string }): QueueItem {
    const item: QueueItem = {
      id: randomUUID(),
      chatId: input.chatId,
      imagePath: input.imagePath,
      topic: input.topic,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.data.items.push(item);
    this.persist();
    return item;
  }

  list(): QueueItem[] {
    return this.data.items;
  }

  next(): QueueItem | undefined {
    const item = this.data.items.find((i) => i.status === "pending");
    if (item) {
      item.status = "processing";
      this.persist();
    }
    return item;
  }

  private setStatus(id: string, status: QueueStatus, error?: string) {
    const item = this.data.items.find((i) => i.id === id);
    if (!item) throw new Error(`Queue item not found: ${id}`);
    item.status = status;
    if (error !== undefined) item.error = error;
    this.persist();
  }

  pause(id: string) {
    this.setStatus(id, "pending"); // paused items re-enter as pending-but-skipped via `next()` order below
  }

  resume(id: string) {
    this.setStatus(id, "pending");
  }

  complete(id: string) {
    this.setStatus(id, "completed");
  }

  fail(id: string, error: string) {
    this.setStatus(id, "failed", error);
  }

  cancel(id: string) {
    this.data.items = this.data.items.filter((i) => i.id !== id);
    this.persist();
  }

  getOffset(): number {
    return this.data.offset;
  }

  setOffset(offset: number) {
    this.data.offset = offset;
    this.persist();
  }
}
```

`pause`/`resume` as written both just reset to `pending`, which does **not** satisfy the "next() skips paused items" test — fix before implementing: add a real `"paused"` status.

- [ ] **Step 3b: Fix — add `"paused"` to `QueueStatus` in `src/types.ts`**

```typescript
export type QueueStatus = "pending" | "processing" | "completed" | "failed" | "paused";
```

And in `src/queue.ts`, change `next()` and `pause`/`resume`:

```typescript
  next(): QueueItem | undefined {
    const item = this.data.items.find((i) => i.status === "pending");
    if (item) {
      item.status = "processing";
      this.persist();
    }
    return item;
  }

  pause(id: string) {
    this.setStatus(id, "paused");
  }

  resume(id: string) {
    this.setStatus(id, "pending");
  }
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test tests/queue.test.ts
```
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/queue.ts tests/queue.test.ts
git commit -m "feat: persisted queue with offset, pause/resume/cancel"
```

---

### Task 6: AI provider invocation

**Files:**
- Create: `src/ai.ts`
- Test: `tests/ai.test.ts`

- [ ] **Step 1: Write failing tests**

Use a tiny fixture script instead of mocking `Bun.spawn` (spawning a real echo-style process is more honest than mocking).

```typescript
// tests/ai.test.ts
import { test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProvider } from "../src/ai.ts";

function fixture(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "img2post-ai-"));
  const path = join(dir, "fixture.sh");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

test("captures stdout on success", async () => {
  const script = fixture(`#!/bin/sh\necho "post text: $1"\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 5 },
    { imagePath: "/tmp/a.jpg", prompt: "write something" }
  );
  expect(result.ok).toBe(true);
  expect(result.stdout.trim()).toBe("post text: /tmp/a.jpg");
});

test("captures stderr and ok=false on non-zero exit", async () => {
  const script = fixture(`#!/bin/sh\necho "bad thing" >&2\nexit 1\n`);
  const result = await runProvider({ command: [script], timeoutSec: 5 }, { imagePath: "/tmp/a.jpg", prompt: "p" });
  expect(result.ok).toBe(false);
  expect(result.stderr.trim()).toBe("bad thing");
});

test("passes prompt via stdin when provider declares stdin:true", async () => {
  const script = fixture(`#!/bin/sh\ncat\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 5, stdin: true },
    { imagePath: "/tmp/a.jpg", prompt: "hello from stdin" }
  );
  expect(result.stdout.trim()).toBe("hello from stdin");
});

test("times out hanging providers", async () => {
  const script = fixture(`#!/bin/sh\nsleep 5\n`);
  const result = await runProvider({ command: [script], timeoutSec: 1 }, { imagePath: "/tmp/a.jpg", prompt: "p" });
  expect(result.ok).toBe(false);
  expect(result.stderr).toMatch(/timeout/i);
});
```

- [ ] **Step 2: Run, verify fail.**

```bash
bun test tests/ai.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/ai.ts
import type { ProviderConfig, ProviderResult } from "./types.ts";

export async function runProvider(
  provider: ProviderConfig,
  input: { imagePath: string; prompt: string }
): Promise<ProviderResult> {
  const argv = Array.isArray(provider.command) ? provider.command : provider.command.split(" ");
  const args = provider.stdin ? [...argv, input.imagePath] : [...argv, input.imagePath, input.prompt];

  const proc = Bun.spawn(args, {
    stdin: provider.stdin ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, IMG2POST_IMAGE_PATH: input.imagePath, IMG2POST_PROMPT: input.prompt },
  });

  if (provider.stdin) {
    proc.stdin.write(input.prompt);
    proc.stdin.end();
  }

  const timeoutMs = provider.timeoutSec * 1000;
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));

  const outcome = await Promise.race([proc.exited, timeout]);

  if (outcome === "timeout") {
    proc.kill();
    return { ok: false, stdout: "", stderr: `timeout after ${provider.timeoutSec}s` };
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { ok: proc.exitCode === 0, stdout, stderr };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test tests/ai.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai.ts tests/ai.test.ts
git commit -m "feat: external AI provider subprocess invocation with timeout"
```

---

### Task 7: Output writer (variant files, collisions)

**Files:**
- Create: `src/output.ts`
- Test: `tests/output.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/output.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePost } from "../src/output.ts";

let cwd: string;
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function setup(): { cwd: string; imagePath: string } {
  cwd = mkdtempSync(join(tmpdir(), "img2post-out-"));
  const imagePath = join(cwd, "meme.jpg");
  writeFileSync(imagePath, "fake-image-bytes");
  return { cwd, imagePath };
}

test("creates dated slug folder with image + variant files", () => {
  const { cwd, imagePath } = setup();
  const dir = writePost({
    cwd,
    imagePath,
    slug: "rsc-learning-curve",
    date: "2026-08-20",
    variants: ["variant one text", "variant two text"],
  });
  expect(dir).toBe(join(cwd, "posts", "2026-08-20_rsc-learning-curve"));
  expect(existsSync(join(dir, "meme.jpg"))).toBe(true);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8")).toBe("variant one text");
  expect(readFileSync(join(dir, "post-2.md"), "utf-8")).toBe("variant two text");
});

test("appends -2, -3 on folder name collision", () => {
  const { cwd, imagePath } = setup();
  mkdirSync(join(cwd, "posts", "2026-08-20_rsc-learning-curve"), { recursive: true });
  mkdirSync(join(cwd, "posts", "2026-08-20_rsc-learning-curve-2"), { recursive: true });
  const dir = writePost({ cwd, imagePath, slug: "rsc-learning-curve", date: "2026-08-20", variants: ["x"] });
  expect(dir).toBe(join(cwd, "posts", "2026-08-20_rsc-learning-curve-3"));
});
```

- [ ] **Step 2: Run, verify fail.**

```bash
bun test tests/output.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/output.ts
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

export function writePost(input: {
  cwd: string;
  imagePath: string;
  slug: string;
  date: string;
  variants: string[];
}): string {
  const base = join(input.cwd, "posts", `${input.date}_${input.slug}`);
  let dir = base;
  let n = 1;
  while (existsSync(dir)) {
    n += 1;
    dir = `${base}-${n}`;
  }
  mkdirSync(dir, { recursive: true });
  copyFileSync(input.imagePath, join(dir, `meme${extname(input.imagePath)}`));
  input.variants.forEach((text, i) => {
    writeFileSync(join(dir, `post-${i + 1}.md`), text);
  });
  return dir;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test tests/output.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat: output writer with variant files and folder collision handling"
```

---

## Chunk 3: Telegram client, bot orchestrator, CLI commands, e2e

### Task 8: Telegram client

**Files:**
- Create: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

- [ ] **Step 1: Write failing tests** (mock global `fetch`, restore after each)

```typescript
// tests/telegram.test.ts
import { test, expect, afterEach, mock } from "bun:test";
import { TelegramClient } from "../src/telegram.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("getMe calls the right endpoint and returns username", async () => {
  globalThis.fetch = mock(async (url: string) => {
    expect(url).toBe("https://api.telegram.org/botTOKEN/getMe");
    return new Response(JSON.stringify({ ok: true, result: { username: "my_post_bot" } }));
  }) as any;
  const client = new TelegramClient("TOKEN");
  const me = await client.getMe();
  expect(me.username).toBe("my_post_bot");
});

test("getUpdates passes offset and timeout", async () => {
  globalThis.fetch = mock(async (url: string) => {
    expect(url).toContain("offset=5");
    expect(url).toContain("timeout=25");
    return new Response(JSON.stringify({ ok: true, result: [] }));
  }) as any;
  const client = new TelegramClient("TOKEN");
  await client.getUpdates(5);
});

test("sendMessage posts chatId and text", async () => {
  globalThis.fetch = mock(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    expect(body).toEqual({ chat_id: 42, text: "hi" });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as any;
  const client = new TelegramClient("TOKEN");
  await client.sendMessage(42, "hi");
});
```

- [ ] **Step 2: Run, verify fail.**

```bash
bun test tests/telegram.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/telegram.ts
const API = "https://api.telegram.org";

export interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string }[];
    document?: { file_id: string; mime_type?: string };
  };
}

export class TelegramClient {
  constructor(private token: string) {}

  private base() {
    return `${API}/bot${this.token}`;
  }

  async getMe(): Promise<{ username: string }> {
    const res = await fetch(`${this.base()}/getMe`);
    const json = await res.json();
    return json.result;
  }

  async getUpdates(offset: number): Promise<TgUpdate[]> {
    const url = `${this.base()}/getUpdates?offset=${offset}&timeout=25&allowed_updates=%5B%22message%22%5D`;
    const res = await fetch(url);
    const json = await res.json();
    return json.result ?? [];
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await fetch(`${this.base()}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }

  async downloadFile(fileId: string, destPath: string): Promise<void> {
    const fileInfo = await (await fetch(`${this.base()}/getFile?file_id=${fileId}`)).json();
    const filePath = fileInfo.result.file_path;
    const res = await fetch(`${API}/file/bot${this.token}/${filePath}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await Bun.write(destPath, bytes);
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test tests/telegram.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: telegram bot API client (fetch-based long-poll)"
```

---

### Task 9: Bot orchestrator

**Files:**
- Create: `src/bot.ts`

No isolated unit test here — this is the wiring layer, covered by the e2e test in Task 12. It is intentionally thin: every piece it calls is already tested.

- [ ] **Step 1: Implement**

```typescript
// src/bot.ts
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import type { Config } from "./types.ts";
import { Queue } from "./queue.ts";
import { TelegramClient, type TgUpdate } from "./telegram.ts";
import { routeTopic } from "./topic-router.ts";
import { runProvider } from "./ai.ts";
import { writePost } from "./output.ts";
import { deriveSlug } from "./slug.ts";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function runBot(config: Config, cwd: string): Promise<void> {
  const tg = new TelegramClient(config.telegram.botToken);
  const queue = new Queue(join(cwd, "queue.json"));

  await tg.getMe();

  let running = true;
  while (running) {
    const updates = await tg.getUpdates(queue.getOffset());
    for (const update of updates) {
      await handleUpdate(update, config, cwd, tg, queue);
      queue.setOffset(update.update_id + 1);
    }
    await drainQueue(queue, config, cwd, tg);
  }
}

async function handleUpdate(
  update: TgUpdate,
  config: Config,
  cwd: string,
  tg: TelegramClient,
  queue: Queue
): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  if (msg.text === "/start") {
    await tg.sendMessage(msg.chat.id, "Send me an image and I'll generate a post from it.");
    return;
  }
  if (msg.text?.startsWith("/") && !msg.photo && !msg.document) {
    await tg.sendMessage(msg.chat.id, `Topics: ${Object.keys(config.topics).join(", ")}`);
    return;
  }

  const fileId = msg.photo?.at(-1)?.file_id ?? msg.document?.file_id;
  if (!fileId) return;

  const ext = MIME_EXT[msg.document?.mime_type ?? ""] ?? "jpg";
  const destDir = mkdtempSync(join(tmpdir(), "img2post-"));
  const destPath = join(destDir, `image-${Date.now()}.${ext}`);
  await tg.downloadFile(fileId, destPath);

  const topic = routeTopic(msg.caption, config.topics, config.defaultTopic);
  const item = queue.add({ chatId: msg.chat.id, imagePath: destPath, topic });
  await tg.sendMessage(msg.chat.id, `📥 Queued (position ${queue.list().filter((i) => i.status === "pending").length})`);
  void item;
}

async function drainQueue(queue: Queue, config: Config, cwd: string, tg: TelegramClient): Promise<void> {
  const item = queue.next();
  if (!item) return;

  await tg.sendMessage(item.chatId, "⏳ Generating post…");

  try {
    const topicConfig = config.topics[item.topic];
    if (!topicConfig) throw new Error(`Unknown topic: ${item.topic}`);
    const providerKey = topicConfig.ai ?? config.ai.default;
    const provider = config.ai.providers[providerKey];
    if (!provider) throw new Error(`Unknown AI provider: ${providerKey}`);

    const prompt = readFileSync(join(config.configDir, topicConfig.promptFile), "utf-8");

    const variants: string[] = [];
    for (let i = 0; i < topicConfig.variants; i++) {
      const result = await runProvider(provider, { imagePath: item.imagePath, prompt });
      if (!result.ok) throw new Error(result.stderr || "AI call failed");
      variants.push(result.stdout.trim());
    }

    const slug = deriveSlug(variants[0]!, item.imagePath);
    const date = new Date().toISOString().slice(0, 10);
    const dir = writePost({ cwd, imagePath: item.imagePath, slug, date, variants });

    queue.complete(item.id);
    await tg.sendMessage(item.chatId, `📁 ${dir}\n\n${variants[0]}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    queue.fail(item.id, message);
    await tg.sendMessage(item.chatId, `❌ ${message}`);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: bot orchestrator (poll, enqueue, sequential drain, ack messages)"
```

---

### Task 10: CLI commands

**Files:**
- Create: `src/commands/init.ts`, `src/commands/post.ts`, `src/commands/topics.ts`, `src/commands/queue.ts`, `src/commands/bot.ts`, `src/help.ts`, `src/index.ts`

- [ ] **Step 1: `src/help.ts`**

```typescript
// src/help.ts
export const HELP = `img-to-post — turn images sent to a Telegram bot into generated posts.

USAGE:
  img-to-post <command> [options]

COMMANDS:
  bot                     Run the Telegram polling loop (foreground)
  init                    Scaffold img-to-post.config.json + prompts/
  post <image> [topic]    One-shot: generate post from a local image
  topics                  List configured topics
  queue list              List queue items with status
  queue pause <id>        Pause a pending queue item
  queue resume <id>       Resume a paused queue item
  queue cancel <id>       Remove a queue item

OPTIONS:
  --config <path>         Path to config file (default: ./img-to-post.config.json)
  --help                  Show this help
`;
```

- [ ] **Step 2: `src/commands/init.ts`**

```typescript
// src/commands/init.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function initCommand(cwd: string): void {
  const configPath = join(cwd, "img-to-post.config.json");
  if (existsSync(configPath)) {
    console.log("img-to-post.config.json already exists, skipping.");
    return;
  }
  mkdirSync(join(cwd, "prompts"), { recursive: true });
  writeFileSync(join(cwd, "prompts", "tech.txt"), "Write a short, punchy tech post about this image.\n");

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        telegram: { botToken: "REPLACE_ME" },
        defaultTopic: "tech",
        ai: {
          default: "mycli",
          providers: { mycli: { command: "mycli --pipe --once", timeoutSec: 120 } },
        },
        topics: {
          tech: { description: "meme -> engineering post", promptFile: "prompts/tech.txt", variants: 1 },
        },
      },
      null,
      2
    )
  );
  console.log(`Created ${configPath} and prompts/tech.txt`);
}
```

- [ ] **Step 3: `src/commands/topics.ts`**

```typescript
// src/commands/topics.ts
import type { Config } from "../types.ts";

export function topicsCommand(config: Config): void {
  for (const [key, topic] of Object.entries(config.topics)) {
    console.log(`${key}\t${topic.description}\t(variants: ${topic.variants})`);
  }
}
```

- [ ] **Step 4: `src/commands/post.ts`**

```typescript
// src/commands/post.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../types.ts";
import { runProvider } from "../ai.ts";
import { writePost } from "../output.ts";
import { deriveSlug } from "../slug.ts";

export async function postCommand(config: Config, cwd: string, imagePath: string, topicKey?: string): Promise<void> {
  const key = topicKey ?? config.defaultTopic;
  const topic = config.topics[key];
  if (!topic) throw new Error(`Unknown topic: ${key}`);

  const providerKey = topic.ai ?? config.ai.default;
  const provider = config.ai.providers[providerKey];
  if (!provider) throw new Error(`Unknown AI provider: ${providerKey}`);

  const prompt = readFileSync(join(config.configDir, topic.promptFile), "utf-8");

  const variants: string[] = [];
  for (let i = 0; i < topic.variants; i++) {
    const result = await runProvider(provider, { imagePath, prompt });
    if (!result.ok) throw new Error(result.stderr || "AI call failed");
    variants.push(result.stdout.trim());
  }

  const slug = deriveSlug(variants[0]!, imagePath);
  const date = new Date().toISOString().slice(0, 10);
  const dir = writePost({ cwd, imagePath, slug, date, variants });
  console.log(`Saved to ${dir}`);
}
```

- [ ] **Step 5: `src/commands/queue.ts`**

```typescript
// src/commands/queue.ts
import { join } from "node:path";
import { Queue } from "../queue.ts";

export function queueCommand(cwd: string, action: string, id?: string): void {
  const queue = new Queue(join(cwd, "queue.json"));
  switch (action) {
    case "list":
      for (const item of queue.list()) {
        console.log(`${item.id}\t${item.status}\t${item.topic}\t${item.imagePath}`);
      }
      break;
    case "pause":
      if (!id) throw new Error("queue pause requires <id>");
      queue.pause(id);
      break;
    case "resume":
      if (!id) throw new Error("queue resume requires <id>");
      queue.resume(id);
      break;
    case "cancel":
      if (!id) throw new Error("queue cancel requires <id>");
      queue.cancel(id);
      break;
    default:
      throw new Error(`Unknown queue action: ${action}`);
  }
}
```

- [ ] **Step 6: `src/commands/bot.ts`**

```typescript
// src/commands/bot.ts
import type { Config } from "../types.ts";
import { runBot } from "../bot.ts";

export async function botCommand(config: Config, cwd: string): Promise<void> {
  console.log(`Starting bot as @${(await new (await import("../telegram.ts")).TelegramClient(config.telegram.botToken).getMe()).username}...`);
  await runBot(config, cwd);
}
```

- [ ] **Step 7: `src/index.ts`** — hand-rolled argv dispatch using `node:util` `parseArgs`

```typescript
#!/usr/bin/env bun
// src/index.ts
import { parseArgs } from "node:util";
import { HELP } from "./help.ts";
import { loadConfig, resolveConfigPath } from "./config.ts";
import { initCommand } from "./commands/init.ts";
import { topicsCommand } from "./commands/topics.ts";
import { postCommand } from "./commands/post.ts";
import { queueCommand } from "./commands/queue.ts";
import { botCommand } from "./commands/bot.ts";

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { config: { type: "string" }, help: { type: "boolean" } },
  });

  const [command, ...rest] = positionals;
  const cwd = process.cwd();

  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  if (command === "init") {
    initCommand(cwd);
    return;
  }

  const config = loadConfig(resolveConfigPath(values.config));

  switch (command) {
    case "bot":
      await botCommand(config, cwd);
      break;
    case "post": {
      const [imagePath, topic] = rest;
      if (!imagePath) throw new Error("usage: img-to-post post <image> [topic]");
      await postCommand(config, cwd, imagePath, topic);
      break;
    }
    case "topics":
      topicsCommand(config);
      break;
    case "queue": {
      const [action, id] = rest;
      if (!action) throw new Error("usage: img-to-post queue list|pause|resume|cancel [id]");
      queueCommand(cwd, action, id);
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
```

- [ ] **Step 8: Typecheck + manual smoke test**

```bash
bun run typecheck
bun src/index.ts --help
bun src/index.ts init
```
Expected: 0 typecheck errors; help text prints; `init` scaffolds config + prompts.

- [ ] **Step 9: Commit**

```bash
git add src/commands src/help.ts src/index.ts
git commit -m "feat: CLI surface (bot, init, post, topics, queue, --help)"
```

---

### Task 11: End-to-end test (mocked Telegram + AI)

**Files:**
- Test: `tests/e2e.test.ts`

Exercises `postCommand` (the one-shot path — simpler to test than the long-poll loop, and it shares every module the bot path uses) end to end with a real fixture AI script and a real filesystem, no Telegram involved.

- [ ] **Step 1: Write test**

```typescript
// tests/e2e.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { postCommand } from "../src/commands/post.ts";

let cwd: string;
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test("image in -> folder created with image + 2 post variants", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-e2e-"));
  mkdirSync(join(cwd, "prompts"));
  writeFileSync(join(cwd, "prompts", "tech.txt"), "describe this");

  const fixture = join(cwd, "fixture-ai.sh");
  writeFileSync(fixture, `#!/bin/sh\necho "SLUG: rsc-learning-curve"\necho "body for $1"\n`);
  chmodSync(fixture, 0o755);

  writeFileSync(
    join(cwd, "img-to-post.config.json"),
    JSON.stringify({
      telegram: { botToken: "x" },
      defaultTopic: "tech",
      ai: { default: "mycli", providers: { mycli: { command: [fixture], timeoutSec: 5 } } },
      topics: { tech: { description: "d", promptFile: "prompts/tech.txt", variants: 2 } },
    })
  );

  const imagePath = join(cwd, "input.jpg");
  writeFileSync(imagePath, "fake-bytes");

  const config = loadConfig(join(cwd, "img-to-post.config.json"));
  await postCommand(config, cwd, imagePath, "tech");

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_rsc-learning-curve`);
  expect(existsSync(join(dir, "meme.jpg"))).toBe(true);
  expect(existsSync(join(dir, "post-1.md"))).toBe(true);
  expect(existsSync(join(dir, "post-2.md"))).toBe(true);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8")).toContain("SLUG: rsc-learning-curve");
});
```

- [ ] **Step 2: Run**

```bash
bun test
```
Expected: every test file passes, including this one.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "test: end-to-end image-to-post via one-shot command"
```

---

### Task 12: Build + final check

- [ ] **Step 1: Typecheck clean**

```bash
bun run typecheck
```
Expected: 0 errors.

- [ ] **Step 2: Full test suite**

```bash
bun test
```
Expected: all pass.

- [ ] **Step 3: Compiled binary smoke test**

```bash
bun run build
./img-to-post --help
```
Expected: prints help text from a standalone binary.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: verify build + full test suite pass"
```

---

## Deferred / explicitly out of scope (per grilling session)

- MTProto/QR user-session login — Bot API only; add the bot as admin to any channel that needs monitoring.
- Same-cwd concurrent instances (locking `queue.json`) — different-cwd isolation only.
- `--help --json` schema dump for AI agents — plain structured text only.
- One-AI-call-returns-N-variants parsing — always N separate subprocess calls.
