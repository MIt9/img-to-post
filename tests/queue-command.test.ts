import { test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "../src/queue.ts";
import { queueCommand } from "../src/commands/queue.ts";

let dir: string;
let logs: string[];
let originalLog: typeof console.log;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "img2post-queue-cmd-"));
  logs = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  rmSync(dir, { recursive: true, force: true });
});

test("list prints 'No queued items.' when the queue is empty", () => {
  queueCommand(dir, "list");

  expect(logs).toEqual(["No queued items."]);
});

test("list shows every item with id, status, topic, and image path", () => {
  const queue = new Queue(join(dir, "queue.json"));
  const a = queue.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  const b = queue.add({ chatId: 2, imagePath: "/tmp/b.jpg", topic: "news" });
  queue.pause(b.id);

  queueCommand(dir, "list");

  expect(logs).toEqual([
    `${a.id}\tpending\ttech\t/tmp/a.jpg`,
    `${b.id}\tpaused\tnews\t/tmp/b.jpg`,
  ]);
});

test("pause on a pending item marks it paused so the worker skips it", () => {
  const queue = new Queue(join(dir, "queue.json"));
  const a = queue.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });

  queueCommand(dir, "pause", a.id);

  const reloaded = new Queue(join(dir, "queue.json"));
  expect(reloaded.list()[0]?.status).toBe("paused");
  expect(reloaded.next()).toBeUndefined();
});

test("resume makes a paused item eligible again", () => {
  const queue = new Queue(join(dir, "queue.json"));
  const a = queue.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  queue.pause(a.id);

  queueCommand(dir, "resume", a.id);

  const reloaded = new Queue(join(dir, "queue.json"));
  expect(reloaded.list()[0]?.status).toBe("pending");
  expect(reloaded.next()?.id).toBe(a.id);
});

test("cancel removes the item so it no longer appears in the queue", () => {
  const queue = new Queue(join(dir, "queue.json"));
  const a = queue.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });
  queue.add({ chatId: 2, imagePath: "/tmp/b.jpg", topic: "news" });

  queueCommand(dir, "cancel", a.id);

  const reloaded = new Queue(join(dir, "queue.json"));
  expect(reloaded.list()).toHaveLength(1);
  expect(reloaded.list().find((i) => i.id === a.id)).toBeUndefined();
});

test("pause on a non-existent id throws a clear error instead of crashing", () => {
  new Queue(join(dir, "queue.json"));

  expect(() => queueCommand(dir, "pause", "does-not-exist")).toThrow(
    'No queue item with id "does-not-exist".',
  );
});

test("resume and cancel on a non-existent id also throw a clear error", () => {
  new Queue(join(dir, "queue.json"));

  expect(() => queueCommand(dir, "resume", "nope")).toThrow('No queue item with id "nope".');
  expect(() => queueCommand(dir, "cancel", "nope")).toThrow('No queue item with id "nope".');
});

test("pause/resume/cancel without an id throws a usage error", () => {
  new Queue(join(dir, "queue.json"));

  expect(() => queueCommand(dir, "pause")).toThrow();
});

test("an unknown action throws a clear error", () => {
  expect(() => queueCommand(dir, "bogus")).toThrow('Unknown queue action: "bogus"');
});
