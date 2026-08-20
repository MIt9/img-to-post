import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/types.ts";
import type { TgUpdate } from "../src/telegram.ts";
import { handleUpdate, runBot } from "../src/bot.ts";

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

test("a photo update generates a post and replies with the saved folder + first variant", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: bot-photo-post"\necho ""\necho "generated text"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = {
    update_id: 1,
    message: { chat: { id: 555 }, photo: [{ file_id: "small" }, { file_id: "big" }] },
  };

  await handleUpdate(update, config, cwd, tg);

  expect(tg.downloaded).toEqual([{ fileId: "big", destPath: expect.any(String) }]);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_bot-photo-post`);
  expect(existsSync(join(dir, "meme.jpg"))).toBe(true);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8").trim()).toBe("generated text");

  expect(tg.sent).toHaveLength(1);
  expect(tg.sent[0]?.chatId).toBe(555);
  expect(tg.sent[0]?.text).toContain(dir);
  expect(tg.sent[0]?.text).toContain("generated text");
});

test("a document update maps mime type to file extension", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: bot-doc-post"\necho ""\necho "doc text"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = {
    update_id: 2,
    message: { chat: { id: 1 }, document: { file_id: "doc1", mime_type: "image/png" } },
  };

  await handleUpdate(update, config, cwd, tg);

  expect(tg.downloaded[0]?.destPath).toMatch(/\.png$/);
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

  const update: TgUpdate = {
    update_id: 3,
    message: { chat: { id: 2 }, caption: "/life check this", photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_routed-post`);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8")).toContain("LIFE PROMPT");
});

test("an unmatched caption falls back to defaultTopic", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: default-routed"\necho ""\necho "ok"\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = {
    update_id: 4,
    message: { chat: { id: 2 }, caption: "/unknown", photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg);

  const dir = join(cwd, "posts", `${new Date().toISOString().slice(0, 10)}_default-routed`);
  expect(existsSync(dir)).toBe(true);
});

test("/start replies with a usage message", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = { update_id: 5, message: { chat: { id: 9 }, text: "/start" } };
  const result = await handleUpdate(update, config, cwd, tg);

  expect(result).toBeUndefined();
  expect(tg.sent).toHaveLength(1);
  expect(tg.sent[0]?.text).toMatch(/photo/i);
});

test("an unrecognized /command with no photo attached replies with the topic list", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = { update_id: 6, message: { chat: { id: 9 }, text: "/wat" } };
  await handleUpdate(update, config, cwd, tg);

  expect(tg.sent).toHaveLength(1);
  expect(tg.sent[0]?.text).toContain("tech");
  expect(tg.sent[0]?.text).toContain("life");
});

test("/stop replies and signals the poll loop to shut down", async () => {
  const script = fixture(`#!/bin/sh\necho unused\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = { update_id: 7, message: { chat: { id: 9 }, text: "/stop" } };
  const result = await handleUpdate(update, config, cwd, tg);

  expect(result).toBe("stop");
  expect(tg.sent).toHaveLength(1);
});

test("AI failure during processing replies with the error and saves no folder", async () => {
  const script = fixture(`#!/bin/sh\necho "boom" >&2\nexit 1\n`);
  cwd = mkdtempSync(join(tmpdir(), "img2post-bot-cwd-"));
  const config = baseConfig(script);
  const tg = fakeTg();

  const update: TgUpdate = {
    update_id: 8,
    message: { chat: { id: 9 }, photo: [{ file_id: "p1" }] },
  };

  await handleUpdate(update, config, cwd, tg);

  expect(existsSync(join(cwd, "posts"))).toBe(false);
  expect(tg.sent).toHaveLength(1);
  expect(tg.sent[0]?.text).toBe("❌ boom");
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
