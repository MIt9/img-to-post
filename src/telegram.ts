export interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string }[];
    document?: { file_id: string; mime_type?: string; file_name?: string };
  };
}

interface TgMe {
  username: string;
}

async function callApi<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(`Telegram API error (${method}): ${json.description ?? "unknown error"}`);
  }
  return json.result as T;
}

export class TelegramClient {
  constructor(private readonly token: string) {}

  getMe(): Promise<TgMe> {
    return callApi<TgMe>(this.token, "getMe");
  }

  getUpdates(offset: number): Promise<TgUpdate[]> {
    return callApi<TgUpdate[]>(this.token, "getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"],
    });
  }

  sendMessage(chatId: number, text: string): Promise<void> {
    return callApi(this.token, "sendMessage", { chat_id: chatId, text }).then(() => undefined);
  }

  async downloadFile(fileId: string, destPath: string): Promise<void> {
    const { file_path } = await callApi<{ file_path: string }>(this.token, "getFile", { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file_path}`);
    await Bun.write(destPath, res);
  }
}
