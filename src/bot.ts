import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types.ts";
import type { TgUpdate } from "./telegram.ts";
import { routeTopic } from "./topic-router.ts";
import { generatePost } from "./generate.ts";

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

export async function handleUpdate(
  update: TgUpdate,
  config: Config,
  cwd: string,
  tg: TgClientLike,
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
  const tmpDir = mkdtempSync(join(tmpdir(), "img2post-bot-"));
  try {
    const imagePath = join(tmpDir, `download${ext}`);
    await tg.downloadFile(fileId, imagePath);
    const { dir, variants } = await generatePost(config, cwd, imagePath, topicKey);
    await tg.sendMessage(chatId, `Saved to ${dir}\n\n${variants[0] ?? ""}`);
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    await tg.sendMessage(chatId, `❌ ${errorText}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const POLL_ERROR_BACKOFF_MS = 2000;

export async function runBot(config: Config, cwd: string, tg: TgPollClientLike): Promise<void> {
  let offset = 0;
  for (;;) {
    let updates: TgUpdate[];
    try {
      updates = await tg.getUpdates(offset);
    } catch (err) {
      console.error(`getUpdates failed, retrying: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_ERROR_BACKOFF_MS));
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const result = await handleUpdate(update, config, cwd, tg);
      if (result === "stop") return;
    }
  }
}
