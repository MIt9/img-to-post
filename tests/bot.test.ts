import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/types.ts";
import type { TgUpdate } from "../src/telegram.ts";
import { handleUpdate, drainQueue, runBot } from "../src/bot.ts";
import { Queue } from "../src/queue.ts";

let cwd: string;
let configDir: string;
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function fixture(script: string): string {
  configDir = mkdtempSync(join(tmpdir(), "img2post-bot-fixture-"));
  const path = join(configDir, "fixture.sh");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  writeFileSync(join(configDir, "prompt.txt"), "p");
  return path;
}

function baseConfig(script: string): Config {
  return {
    telegram: { botToken: "t" },
    defaultTopic: "tech",
    ai: { default: "mycli", providers: { mycli: { command: [script], timeoutSec: 5 } } },
    topics: {
      tech: { description: "tech posts", promptFile: "prompt.txt" },
      life: { description: "life posts", promptFile: "prompt.txt" },
    },
    configDir,
  };
}

function fakeTg(fileBytes = "bytes") {
  const sent: { chatId: number; text: string }[] = [];
  const downloaded: { fileId: string; destPath: string }[] = [];
  return {
    sent,
    downloaded,
    async sendMessage(chatId: number, text: string) {
      sent.push({ chatId, text });
    },
    async downloadFile(fileId: string, destPath: string) {
      downloaded.push({ fileId, destPath });
      writeFileSync(destPath, fileBytes);
    },
  };
}

function newQueue(): Queue {
  const dir = mkdtempSync(join(tmpdir(), "img2post-bot-queue-"));
  return new Queue(join(dir, "queue.json"));
}

test("a photo update is queued immediately, then processed by drainQueue", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: bot-photo-post"\necho ""\necho "generated text"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = {
    update_id: 1,
    message: { chat: { id: 555 }, photo: [{ file_id: "small" }, { file_id: "big" }] },
  };

  await handleUpdate(update, config, cwd, tg, queue);

  expect(tg.downloaded).toHaveLength(1);
  expect(tg.downloaded[0]?.fileId).toBe("big");
  expect(tg.sent).toEqual([{ chatId: 555, text: "📥 Queued (position 1)" }]);
  expect(queue.list()).toHaveLength(1);
  expect(queue.list()[0]?.status).toBe("pending");

  await drainQueue(queue, config, cwd, tg);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_bot-photo-post`);
  expect(existsSync(join(dir, "meme.jpg"))).toBe(true);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8").trim()).toBe("generated text");

  expect(tg.sent).toHaveLength(3);
  expect(tg.sent[1]).toEqual({ chatId: 555, text: "⏳ Generating post…" });
  expect(tg.sent[2]?.chatId).toBe(555);
  expect(tg.sent[2]?.text).toContain(dir);
  expect(tg.sent[2]?.text).toContain("generated text");
  expect(queue.list()[0]?.status).toBe("completed");
});

test("a document update maps mime type to file extension", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: bot-doc-post"\necho ""\necho "doc text"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = {
    update_id: 2,
    message: { chat: { id: 1 }, document: { file_id: "doc1", mime_type: "image/png" } },
  };

  await handleUpdate(update, config, cwd, tg, queue);

  expect(tg.downloaded[0]?.destPath).toMatch(/\.png$/);
  expect(queue.list()[0]?.imagePath).toMatch(/\.png$/);

  await drainQueue(queue, config, cwd, tg);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_bot-doc-post`);
  expect(existsSync(dir)).toBe(true);
});

test("a caption matching a configured topic key routes to that topic", async () => {
  const script = fixture(
    `#!/bin/sh\necho "SLUG: routed-post"\necho ""\necho "prompt=$2"\n`,
  );
  writeFileSync(join(configDir, "life-prompt.txt"), "LIFE PROMPT");
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  config.topics.life = { description: "life posts", promptFile: "life-prompt.txt" };
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = {
    update_id: 3,
    message: { chat: { id: 2 }, caption: "/life check this", photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg, queue);
  expect(queue.list()[0]?.topic).toBe("life");
  await drainQueue(queue, config, cwd, tg);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_routed-post`);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8")).toContain("LIFE PROMPT");
});

test("an unmatched caption falls back to defaultTopic", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: default-routed"\necho ""\necho "ok"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = {
    update_id: 4,
    message: { chat: { id: 2 }, caption: "/unknown", photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg, queue);
  expect(queue.list()[0]?.topic).toBe("tech");
  await drainQueue(queue, config, cwd, tg);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_default-routed`);
  expect(existsSync(dir)).toBe(true);
});

test("/start replies with a usage message", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = { update_id: 5, message: { chat: { id: 9 }, text: "/start" } };
  const result = await handleUpdate(update, config, cwd, tg, queue);

  expect(result).toBeUndefined();
  expect(tg.sent).toHaveLength(1);
  expect(tg.sent[0]?.text).toMatch(/photo/i);
  expect(queue.list()).toHaveLength(0);
});

test("an unrecognized /command with no photo attached replies with the topic list", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = { update_id: 6, message: { chat: { id: 9 }, text: "/wat" } };
  await handleUpdate(update, config, cwd, tg, queue);

  expect(tg.sent).toHaveLength(1);
  expect(tg.sent[0]?.text).toContain("tech");
  expect(tg.sent[0]?.text).toContain("life");
});

test("/stop replies and signals the poll loop to shut down", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = { update_id: 7, message: { chat: { id: 9 }, text: "/stop" } };
  const result = await handleUpdate(update, config, cwd, tg, queue);

  expect(result).toBe("stop");
  expect(tg.sent).toHaveLength(1);
});

test("AI failure during processing replies with the error and saves no folder", async () => {
  const script = fixture(`#!/bin/sh\necho "boom" >&2\nexit 1\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = {
    update_id: 8,
    message: { chat: { id: 9 }, photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg, queue);
  await drainQueue(queue, config, cwd, tg);

  expect(existsSync(join(cwd, "posts"))).toBe(false);
  expect(tg.sent).toHaveLength(3);
  expect(tg.sent[2]?.text).toBe("❌ boom");
  expect(queue.list()[0]?.status).toBe("failed");
  expect(queue.list()[0]?.error).toBe("boom");
});

test("a download failure replies with an error instead of crashing and does not enqueue", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const queue = newQueue();
  const sent: { chatId: number; text: string }[] = [];
  const tg = {
    async sendMessage(chatId: number, text: string) {
      sent.push({ chatId, text });
    },
    async downloadFile() {
      throw new Error("network blip");
    },
  };

  const update: TgUpdate = {
    update_id: 1,
    message: { chat: { id: 9 }, photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg, queue);

  expect(queue.list()).toHaveLength(0);
  expect(sent).toEqual([{ chatId: 9, text: "❌ network blip" }]);
});

test("a send failure inside drainQueue does not crash and leaves the item failed, not stuck processing", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: x"\necho ""\necho "text"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const queue = newQueue();
  const item = queue.add({ chatId: 9, imagePath: join(cwd, "does-not-matter.jpg"), topic: "tech" });
  writeFileSync(item.imagePath, "bytes");
  const tg = {
    async sendMessage() {
      throw new Error("chat blocked the bot");
    },
    async downloadFile() {},
  };

  const processed = await drainQueue(queue, config, cwd, tg);

  expect(processed).toBe(true);
  expect(queue.list()[0]?.status).toBe("failed");
});

test("queued position accounts for an item currently processing, not just pending ones", async () => {
  const script = fixture(`#!/bin/sh\nsleep 5\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const queue = newQueue();
  queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.next(); // now "processing"
  const tg = fakeTg();

  await handleUpdate(
    { update_id: 1, message: { chat: { id: 2 }, photo: [{ file_id: "p1" }] } },
    config,
    cwd,
    tg,
    queue,
  );

  expect(tg.sent).toEqual([{ chatId: 2, text: "📥 Queued (position 2)" }]);
});

test("sending 2 images back-to-back queues both and processes them strictly sequentially", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: seq-$1"\necho ""\necho "text-$1"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  await handleUpdate(
    { update_id: 1, message: { chat: { id: 1 }, photo: [{ file_id: "p1" }] } },
    config,
    cwd,
    tg,
    queue,
  );
  await handleUpdate(
    { update_id: 2, message: { chat: { id: 2 }, photo: [{ file_id: "p2" }] } },
    config,
    cwd,
    tg,
    queue,
  );

  expect(tg.sent).toEqual([
    { chatId: 1, text: "📥 Queued (position 1)" },
    { chatId: 2, text: "📥 Queued (position 2)" },
  ]);
  expect(queue.list().map((i) => i.status)).toEqual(["pending", "pending"]);

  await drainQueue(queue, config, cwd, tg);
  expect(queue.list().map((i) => i.status)).toEqual(["completed", "pending"]);

  await drainQueue(queue, config, cwd, tg);
  expect(queue.list().map((i) => i.status)).toEqual(["completed", "completed"]);
});

test("runBot survives a getUpdates failure instead of crashing the process", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const sent: { chatId: number; text: string }[] = [];
  let call = 0;

  const tg = {
    async sendMessage(chatId: number, text: string) {
      sent.push({ chatId, text });
    },
    async downloadFile() {},
    async getUpdates(_offset: number) {
      call += 1;
      if (call === 1) throw new Error("network blip");
      return [{ update_id: 1, message: { chat: { id: 1 }, text: "/stop" } }];
    },
  };

  await runBot(config, cwd, tg);

  expect(call).toBeGreaterThanOrEqual(2);
  expect(sent.some((m) => m.text.includes("Bye"))).toBe(true);
});

test("restart resumes the queue and offset without reprocessing or duplicate replies", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: resume-post"\necho ""\necho "resumed text"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const queuePath = join(cwd, "queue.json");

  const firstRunTg = fakeTg();
  const firstQueue = new Queue(queuePath);
  await handleUpdate(
    { update_id: 1, message: { chat: { id: 1 }, photo: [{ file_id: "p1" }] } },
    config,
    cwd,
    firstRunTg,
    firstQueue,
  );
  firstQueue.setOffset(2);
  // process crashes here, before draining — the queued item is still "pending" on disk

  const secondRunTg = fakeTg();
  const restartedQueue = new Queue(queuePath);

  expect(restartedQueue.getOffset()).toBe(2);
  expect(restartedQueue.list()).toHaveLength(1);
  expect(restartedQueue.list()[0]?.status).toBe("pending");

  const processed = await drainQueue(restartedQueue, config, cwd, secondRunTg);

  expect(processed).toBe(true);
  expect(restartedQueue.list()[0]?.status).toBe("completed");
  expect(secondRunTg.sent.map((m) => m.text)).toEqual([
    "⏳ Generating post…",
    expect.stringContaining("resumed text"),
  ]);
  // no Telegram replies were re-sent for the update consumed during the first run
  expect(firstRunTg.sent).toEqual([{ chatId: 1, text: "📥 Queued (position 1)" }]);
});

test("a /all caption fans out one download into one queue item per configured topic", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  const update: TgUpdate = {
    update_id: 1,
    message: { chat: { id: 9 }, caption: "/all", photo: [{ file_id: "p1" }] },
  };
  await handleUpdate(update, config, cwd, tg, queue);

  expect(tg.downloaded).toHaveLength(1);
  const items = queue.list();
  expect(items).toHaveLength(2);
  expect(items.map((i) => i.topic).sort()).toEqual(["life", "tech"]);
  expect(new Set(items.map((i) => i.imagePath)).size).toBe(2);
  const batchId = items[0]?.batchId;
  expect(batchId).toBeTruthy();
  expect(items.every((i) => i.batchId === batchId)).toBe(true);
  expect(tg.sent).toEqual([{ chatId: 9, text: "📥 Queued 2 posts (all topics)" }]);
});

test("/all fan-out cleans up the shared base download after making per-topic copies", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  await handleUpdate(
    { update_id: 1, message: { chat: { id: 9 }, caption: "/all", photo: [{ file_id: "p1" }] } },
    config,
    cwd,
    tg,
    queue,
  );

  const downloadsDir = join(cwd, ".img-to-post-downloads");
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(downloadsDir);
  // exactly one file per queue item's imagePath, no extra leftover base download
  expect(files).toHaveLength(2);
  expect(queue.list().every((i) => files.includes(i.imagePath.split("/").pop()!))).toBe(true);
});

test("draining a batch sends one progress message, then one combined summary (mixed success/failure)", async () => {
  const script = fixture(
    `#!/bin/sh\ncase "$1" in *life*) echo "boom" >&2; exit 1 ;; *) echo "SLUG: ok-post"; echo ""; echo "text" ;; esac\n`,
  );
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();
  const queue = newQueue();

  await handleUpdate(
    { update_id: 1, message: { chat: { id: 9 }, caption: "/all", photo: [{ file_id: "p1" }] } },
    config,
    cwd,
    tg,
    queue,
  );
  tg.sent.length = 0;

  await drainQueue(queue, config, cwd, tg);
  expect(tg.sent).toEqual([{ chatId: 9, text: "⏳ Generating posts (2)…" }]);

  await drainQueue(queue, config, cwd, tg);
  expect(tg.sent).toHaveLength(2);
  const summary = tg.sent[1]!.text;
  expect(summary).toContain("2 posts done");
  expect(summary).toMatch(/✓ tech: .*posts/);
  expect(summary).toContain("✗ life: boom");

  expect(queue.list().find((i) => i.topic === "tech")?.status).toBe("completed");
  expect(queue.list().find((i) => i.topic === "life")?.status).toBe("failed");
});
