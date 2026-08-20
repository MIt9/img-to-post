import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramClient } from "../src/telegram.ts";

const originalFetch = globalThis.fetch;
let dir: string;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("getMe calls the getMe endpoint with the token in the URL", async () => {
  let calledUrl = "";
  globalThis.fetch = (async (url: string) => {
    calledUrl = url.toString();
    return new Response(JSON.stringify({ ok: true, result: { username: "bot" } }));
  }) as typeof fetch;

  const tg = new TelegramClient("TOKEN");
  const me = await tg.getMe();

  expect(calledUrl).toBe("https://api.telegram.org/botTOKEN/getMe");
  expect(me.username).toBe("bot");
});

test("getUpdates passes offset, timeout and allowed_updates in the request body", async () => {
  let calledUrl = "";
  let calledBody: unknown;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calledUrl = url.toString();
    calledBody = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ ok: true, result: [{ update_id: 42 }] }));
  }) as typeof fetch;

  const tg = new TelegramClient("TOKEN");
  const updates = await tg.getUpdates(7);

  expect(calledUrl).toBe("https://api.telegram.org/botTOKEN/getUpdates");
  expect(calledBody).toEqual({ offset: 7, timeout: 25, allowed_updates: ["message"] });
  expect(updates).toEqual([{ update_id: 42 }]);
});

test("sendMessage posts chat_id and text to the sendMessage endpoint", async () => {
  let calledUrl = "";
  let calledBody: unknown;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calledUrl = url.toString();
    calledBody = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as typeof fetch;

  const tg = new TelegramClient("TOKEN");
  await tg.sendMessage(123, "hello");

  expect(calledUrl).toBe("https://api.telegram.org/botTOKEN/sendMessage");
  expect(calledBody).toEqual({ chat_id: 123, text: "hello" });
});

test("downloadFile resolves the file path via getFile then writes the bytes from the file endpoint", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(url.toString());
    if (url.toString().endsWith("/getFile")) {
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ file_id: "FILE1" });
      return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/file_1.jpg" } }));
    }
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;

  dir = mkdtempSync(join(tmpdir(), "img2post-tg-"));
  const dest = join(dir, "out.jpg");

  const tg = new TelegramClient("TOKEN");
  await tg.downloadFile("FILE1", dest);

  expect(calls[0]).toBe("https://api.telegram.org/botTOKEN/getFile");
  expect(calls[1]).toBe("https://api.telegram.org/file/botTOKEN/photos/file_1.jpg");
  expect([...readFileSync(dest)]).toEqual([1, 2, 3]);
});

test("downloadFile throws when the file fetch response is not ok", async () => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.toString().endsWith("/getFile")) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/file_1.jpg" } }));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  dir = mkdtempSync(join(tmpdir(), "img2post-tg-"));
  const dest = join(dir, "out.jpg");

  const tg = new TelegramClient("TOKEN");
  await expect(tg.downloadFile("FILE1", dest)).rejects.toThrow(/404/);
});

test("throws when the Bot API responds with ok:false", async () => {
  globalThis.fetch = (async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: false, description: "Unauthorized" }))) as typeof fetch;

  const tg = new TelegramClient("TOKEN");
  await expect(tg.getMe()).rejects.toThrow(/Unauthorized/);
});
