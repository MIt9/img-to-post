import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { QueueItem } from "./types.ts";

interface QueueFile {
  offset: number;
  items: QueueItem[];
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export class Queue {
  private items: QueueItem[] = [];
  private offset = 0;

  constructor(private readonly path: string) {
    this.reload();
  }

  // Re-reads the file before every operation so a long-lived instance (the bot's poll
  // loop) and short-lived instances (the `queue` CLI, run in a second terminal against
  // the same working directory) never clobber each other's writes with a stale in-memory
  // copy. This doesn't make concurrent writes atomic (still no locking, see ticket 05's
  // explicit no-concurrent-instances scope) but it closes the common lost-update case
  // where the bot process holds one Queue object for its entire runtime.
  private reload(): void {
    if (!existsSync(this.path)) return;
    const data = JSON.parse(readFileSync(this.path, "utf-8")) as QueueFile;
    this.items = data.items ?? [];
    this.offset = data.offset ?? 0;
  }

  private persist(): void {
    const data: QueueFile = { offset: this.offset, items: this.items };
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  // Call once, at process startup, before polling — never from the CLI's short-lived
  // instances, which must not disturb an item another (still-alive) process is actively
  // generating. Recovers items a *crashed* prior run abandoned mid-generation.
  reclaimStaleProcessing(): void {
    this.reload();
    let reclaimed = false;
    for (const item of this.items) {
      if (item.status === "processing") {
        item.status = "pending";
        reclaimed = true;
      }
    }
    if (reclaimed) this.persist();
  }

  add(input: { chatId: number; imagePath: string; topic: string; batchId?: string }): QueueItem {
    this.reload();
    const item: QueueItem = {
      id: nextId(),
      chatId: input.chatId,
      imagePath: input.imagePath,
      topic: input.topic,
      status: "pending",
      createdAt: new Date().toISOString(),
      batchId: input.batchId,
    };
    this.items.push(item);
    this.persist();
    return item;
  }

  list(): QueueItem[] {
    this.reload();
    return [...this.items];
  }

  next(): QueueItem | undefined {
    this.reload();
    const item = this.items.find((i) => i.status === "pending");
    if (!item) return undefined;
    item.status = "processing";
    this.persist();
    return item;
  }

  private find(id: string): QueueItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  complete(id: string, resultSummary?: string, targetDir?: string): void {
    this.reload();
    const item = this.find(id);
    if (!item) return;
    item.status = "completed";
    item.resultSummary = resultSummary;
    if (targetDir) item.targetDir = targetDir;
    this.persist();
  }

  fail(id: string, error: string): void {
    this.reload();
    const item = this.find(id);
    if (!item) return;
    item.status = "failed";
    item.error = error;
    this.persist();
  }

  pause(id: string): void {
    this.reload();
    const item = this.find(id);
    if (!item) return;
    item.status = "paused";
    this.persist();
  }

  resume(id: string): void {
    this.reload();
    const item = this.find(id);
    if (!item) return;
    item.status = "pending";
    this.persist();
  }

  cancel(id: string): void {
    this.reload();
    this.items = this.items.filter((i) => i.id !== id);
    this.persist();
  }

  getOffset(): number {
    this.reload();
    return this.offset;
  }

  setOffset(n: number): void {
    this.reload();
    this.offset = n;
    this.persist();
  }
}
