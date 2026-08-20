import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types.ts";
import type { TgUpdate } from "./telegram.ts";
import { routeTopic } from "./topic-router.ts";
import { generatePost } from "./generate.ts";
import { Queue } from "./queue.ts";

const USAGE =
  "Send a photo (optionally with a /<topic> caption) and I'll turn it into a post.\n\n" +
  "Commands:\n/start - show this message\n/stop - shut the bot down";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function documentExt(mimeType: string | undefined, fileName: string | undefined): string {
  if (mimeType && MIME_EXT[mimeType]) return MIME_EXT[mimeType];
  const match = fileName?.match(/\.[a-z0-9]+$/i);
  return match?.[0] ?? ".jpg";
}

function topicList(config: Config): string {
  const lines = Object.entries(config.topics).map(([key, topic]) => `${key}\t${topic.description}`);
  return lines.length ? lines.join("\n") : "No topics configured.";
}

export interface TgClientLike {
  sendMessage(chatId: number, text: string): Promise<void>;
  downloadFile(fileId: string, destPath: string): Promise<void>;
}

export interface TgPollClientLike extends TgClientLike {
  getUpdates(offset: number): Promise<TgUpdate[]>;
}

const DOWNLOADS_DIR_NAME = ".img-to-post-downloads";

let downloadCounter = 0;
function nextDownloadName(ext: string): string {
  downloadCounter += 1;
  return `${Date.now()}-${downloadCounter}${ext}`;
}

export async function handleUpdate(
  update: TgUpdate,
  config: Config,
  cwd: string,
  tg: TgClientLike,
  queue: Queue,
): Promise<"stop" | void> {
  const message = update.message;
  if (!message) return;
  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (text === "/start") {
    await tg.sendMessage(chatId, USAGE);
    return;
  }
  if (text === "/stop") {
    await tg.sendMessage(chatId, "Stopping. Bye!");
    return "stop";
  }

  let fileId: string | undefined;
  let ext = ".jpg";
  const photos = message.photo;
  if (photos && photos.length > 0) {
    fileId = photos[photos.length - 1]?.file_id;
  } else if (message.document) {
    fileId = message.document.file_id;
    ext = documentExt(message.document.mime_type, message.document.file_name);
  }

  if (!fileId) {
    if (text?.startsWith("/")) {
      await tg.sendMessage(chatId, topicList(config));
    }
    return;
  }

  const topicKey = routeTopic(message.caption, config.topics, config.defaultTopic);
  try {
    const downloadsDir = join(cwd, DOWNLOADS_DIR_NAME);
    if (!existsSync(downloadsDir)) mkdirSync(downloadsDir, { recursive: true });
    const imagePath = join(downloadsDir, nextDownloadName(ext));
    await tg.downloadFile(fileId, imagePath);

    queue.add({ chatId, imagePath, topic: topicKey });
    const position = queue.list().filter((i) => i.status === "pending" || i.status === "processing").length;
    await tg.sendMessage(chatId, `📥 Queued (position ${position})`);
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    await tg.sendMessage(chatId, `❌ ${errorText}`).catch(() => {});
  }
}

export async function drainQueue(queue: Queue, config: Config, cwd: string, tg: TgClientLike): Promise<boolean> {
  const item = queue.next();
  if (!item) return false;

  try {
    await tg.sendMessage(item.chatId, "⏳ Generating post…");
    const { dir, variants } = await generatePost(config, cwd, item.imagePath, item.topic);
    queue.complete(item.id);
    await tg.sendMessage(item.chatId, `Saved to ${dir}\n\n${variants[0] ?? ""}`);
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    queue.fail(item.id, errorText);
    await tg.sendMessage(item.chatId, `❌ ${errorText}`).catch(() => {});
  } finally {
    rmSync(item.imagePath, { force: true });
  }
  return true;
}

const POLL_ERROR_BACKOFF_MS = 2000;

export async function runBot(config: Config, cwd: string, tg: TgPollClientLike): Promise<void> {
  const queue = new Queue(join(cwd, "queue.json"));
  for (;;) {
    let updates: TgUpdate[];
    try {
      updates = await tg.getUpdates(queue.getOffset());
    } catch (err) {
      console.error(`getUpdates failed, retrying: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_ERROR_BACKOFF_MS));
      continue;
    }
    for (const update of updates) {
      queue.setOffset(update.update_id + 1);
      const result = await handleUpdate(update, config, cwd, tg, queue);
      if (result === "stop") return;
    }
    while (await drainQueue(queue, config, cwd, tg)) {
      // keep draining until the queue is empty before blocking on the next long poll
    }
  }
}
