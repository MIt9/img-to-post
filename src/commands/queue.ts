import { join } from "node:path";
import { Queue } from "../queue.ts";

export function queueCommand(cwd: string, action: string, id?: string): void {
  const queue = new Queue(join(cwd, "queue.json"));

  if (action === "list") {
    const items = queue.list();
    if (items.length === 0) {
      console.log("No queued items.");
      return;
    }
    for (const item of items) {
      console.log(`${item.id}\t${item.status}\t${item.topic}\t${item.imagePath}`);
    }
    return;
  }

  if (action === "pause" || action === "resume" || action === "cancel") {
    if (!id) throw new Error(`usage: img-to-post queue ${action} <id>`);
    const item = queue.list().find((i) => i.id === id);
    if (!item) throw new Error(`No queue item with id "${id}".`);
    if (action === "pause") {
      if (item.status !== "pending") {
        throw new Error(`Cannot pause "${id}": status is "${item.status}", not "pending".`);
      }
      queue.pause(id);
    } else if (action === "resume") {
      if (item.status !== "paused") {
        throw new Error(`Cannot resume "${id}": status is "${item.status}", not "paused".`);
      }
      queue.resume(id);
    } else {
      queue.cancel(id);
    }
    return;
  }

  throw new Error(`Unknown queue action: "${action}". Use list, pause, resume, or cancel.`);
}
