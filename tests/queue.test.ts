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

test("a crash-abandoned processing item is reclaimed as pending on reload, not stuck forever", () => {
  const path = queuePath();
  const original = new Queue(path);
  const a = original.add({ chatId: 1, imagePath: "a", topic: "tech" });
  original.next();
  expect(original.list().find((i) => i.id === a.id)?.status).toBe("processing");

  const reloaded = new Queue(path);

  expect(reloaded.list().find((i) => i.id === a.id)?.status).toBe("pending");
  expect(reloaded.next()?.id).toBe(a.id);
});
