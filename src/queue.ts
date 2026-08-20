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
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf-8")) as QueueFile;
      this.items = data.items ?? [];
      this.offset = data.offset ?? 0;
    }
  }

  private persist(): void {
    const data: QueueFile = { offset: this.offset, items: this.items };
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  add(input: { chatId: number; imagePath: string; topic: string }): QueueItem {
    const item: QueueItem = {
      id: nextId(),
      chatId: input.chatId,
      imagePath: input.imagePath,
      topic: input.topic,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    this.persist();
    return item;
  }

  list(): QueueItem[] {
    return [...this.items];
  }

  next(): QueueItem | undefined {
    const item = this.items.find((i) => i.status === "pending");
    if (!item) return undefined;
    item.status = "processing";
    this.persist();
    return item;
  }

  private find(id: string): QueueItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  complete(id: string): void {
    const item = this.find(id);
    if (!item) return;
    item.status = "completed";
    this.persist();
  }

  fail(id: string, error: string): void {
    const item = this.find(id);
    if (!item) return;
    item.status = "failed";
    item.error = error;
    this.persist();
  }

  pause(id: string): void {
    const item = this.find(id);
    if (!item) return;
    item.status = "paused";
    this.persist();
  }

  resume(id: string): void {
    const item = this.find(id);
    if (!item) return;
    item.status = "pending";
    this.persist();
  }

  cancel(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.persist();
  }

  getOffset(): number {
    return this.offset;
  }

  setOffset(n: number): void {
    this.offset = n;
    this.persist();
  }
}
