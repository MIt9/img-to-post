import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "../src/queue.ts";

let dir: string;
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function queuePath(): string {
  dir = mkdtempSync(join(tmpdir(), "img2post-queue-"));
  return join(dir, "queue.json");
}

test("add appends a pending item and persists it", () => {
  const queue = new Queue(queuePath());
  const item = queue.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech" });

  expect(item.status).toBe("pending");
  expect(item.id).toBeTruthy();
  expect(item.createdAt).toBeTruthy();
  expect(queue.list()).toEqual([item]);
});

test("add accepts an optional batchId and persists it", () => {
  const queue = new Queue(queuePath());
  const item = queue.add({ chatId: 1, imagePath: "/tmp/a.jpg", topic: "tech", batchId: "batch-1" });

  expect(item.batchId).toBe("batch-1");
  expect(queue.list()[0]?.batchId).toBe("batch-1");
});

test("complete accepts an optional resultSummary and persists it", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.next();
  queue.complete(a.id, "/cwd/posts/2026-08-20_slug");

  expect(queue.list()[0]?.resultSummary).toBe("/cwd/posts/2026-08-20_slug");
});

test("list returns items in insertion order", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  const b = queue.add({ chatId: 2, imagePath: "b", topic: "tech" });

  expect(queue.list().map((i) => i.id)).toEqual([a.id, b.id]);
});

test("next returns the first pending item and marks it processing", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.add({ chatId: 2, imagePath: "b", topic: "tech" });

  const picked = queue.next();

  expect(picked?.id).toBe(a.id);
  expect(picked?.status).toBe("processing");
  expect(queue.list()[0]?.status).toBe("processing");
});

test("next skips paused items and returns undefined when nothing is pending", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.pause(a.id);

  expect(queue.next()).toBeUndefined();
});

test("next does not return the same item twice while it's processing", () => {
  const queue = new Queue(queuePath());
  queue.add({ chatId: 1, imagePath: "a", topic: "tech" });

  const first = queue.next();
  const second = queue.next();

  expect(first).toBeDefined();
  expect(second).toBeUndefined();
});

test("complete marks an item completed", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.next();
  queue.complete(a.id);

  expect(queue.list()[0]?.status).toBe("completed");
});

test("fail marks an item failed and records the error", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.next();
  queue.fail(a.id, "boom");

  expect(queue.list()[0]?.status).toBe("failed");
  expect(queue.list()[0]?.error).toBe("boom");
});

test("pause and resume toggle an item between paused and pending", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });

  queue.pause(a.id);
  expect(queue.list()[0]?.status).toBe("paused");

  queue.resume(a.id);
  expect(queue.list()[0]?.status).toBe("pending");
});

test("cancel removes the item entirely", () => {
  const queue = new Queue(queuePath());
  const a = queue.add({ chatId: 1, imagePath: "a", topic: "tech" });
  queue.add({ chatId: 2, imagePath: "b", topic: "tech" });

  queue.cancel(a.id);

  expect(queue.list()).toHaveLength(1);
  expect(queue.list()[0]?.imagePath).toBe("b");
});

test("getOffset/setOffset track the Telegram getUpdates offset", () => {
  const queue = new Queue(queuePath());
  expect(queue.getOffset()).toBe(0);

  queue.setOffset(42);
  expect(queue.getOffset()).toBe(42);
});

test("queue and offset state survives being reloaded from a fresh Queue instance", () => {
  const path = queuePath();
  const original = new Queue(path);
  original.add({ chatId: 1, imagePath: "a", topic: "tech" });
  original.add({ chatId: 2, imagePath: "b", topic: "tech" });
  original.setOffset(7);

  const reloaded = new Queue(path);

  expect(reloaded.getOffset()).toBe(7);
  expect(reloaded.list()).toHaveLength(2);
});

test("a crash-abandoned processing item is reclaimed as pending by reclaimStaleProcessing, not stuck forever", () => {
  const path = queuePath();
  const original = new Queue(path);
  const a = original.add({ chatId: 1, imagePath: "a", topic: "tech" });
  original.next();
  expect(original.list().find((i) => i.id === a.id)?.status).toBe("processing");

  const reloaded = new Queue(path);
  reloaded.reclaimStaleProcessing();

  expect(reloaded.list().find((i) => i.id === a.id)?.status).toBe("pending");
  expect(reloaded.next()?.id).toBe(a.id);
});

test("merely constructing or listing does not reclaim a genuinely in-flight processing item", () => {
  const path = queuePath();
  const original = new Queue(path);
  const a = original.add({ chatId: 1, imagePath: "a", topic: "tech" });
  original.next();

  const secondInstance = new Queue(path);
  expect(secondInstance.list().find((i) => i.id === a.id)?.status).toBe("processing");
});

test("a second Queue instance's write survives a long-lived instance's next persist (CLI vs. bot)", () => {
  const path = queuePath();
  const botQueue = new Queue(path);
  const a = botQueue.add({ chatId: 1, imagePath: "a", topic: "tech" });

  const cliQueue = new Queue(path);
  cliQueue.pause(a.id);

  botQueue.setOffset(5);

  const reloaded = new Queue(path);
  expect(reloaded.list().find((i) => i.id === a.id)?.status).toBe("paused");
  expect(reloaded.getOffset()).toBe(5);
});
