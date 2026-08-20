import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Config } from "../types.ts";
import { resolveConfigPath } from "../config.ts";
import { TelegramClient } from "../telegram.ts";

const STARTER_PROMPT = "Write a short, punchy engineering-focused post based on this image.\n";

export interface WizardIO {
  ask(prompt: string): Promise<string>;
  print(line: string): void;
  close(): void;
}

// A real TTY never sends EOF mid-session, so node:readline's question-per-line works
// fine there. Piped/scripted stdin (used by AI agents driving this CLI, or by anyone
// piping canned answers) closes as soon as the writer finishes — and node:readline
// closes its interface on that EOF even with buffered-but-unconsumed lines still
// pending, so a later question() throws "readline was closed" mid-wizard. Read all of
// stdin upfront in that case instead of asking line-by-line.
export async function createStdioWizardIO(): Promise<WizardIO> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return {
      ask: (prompt) => rl.question(prompt),
      print: (line) => console.log(line),
      close: () => rl.close(),
    };
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const lines = Buffer.concat(chunks).toString("utf-8").split("\n");
  let i = 0;
  return {
    ask: async (prompt) => {
      console.log(prompt);
      const line = lines[i] ?? "";
      i += 1;
      return line;
    },
    print: (line) => console.log(line),
    close: () => {},
  };
}

export type TokenVerifier = (token: string) => Promise<{ username: string }>;

const defaultVerifyToken: TokenVerifier = (token) => new TelegramClient(token).getMe();

function isYes(answer: string): boolean {
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

function isNo(answer: string): boolean {
  return answer.trim().toLowerCase() === "n" || answer.trim().toLowerCase() === "no";
}

export async function runSetupWizard(
  cwd: string,
  io: WizardIO,
  explicitConfigPath?: string,
  verifyToken: TokenVerifier = defaultVerifyToken,
): Promise<void> {
  const configPath = resolve(cwd, resolveConfigPath(explicitConfigPath));

  if (existsSync(configPath)) {
    const answer = await io.ask(`${configPath} already exists. Overwrite it? (y/N) `);
    if (!isYes(answer)) {
      io.print("Cancelled — existing config left untouched.");
      return;
    }
  }

  io.print("=== img-to-post setup ===");
  io.print("");
  io.print("Step 1 of 3: Telegram bot token");
  io.print("  1. Open Telegram and message @BotFather");
  io.print("  2. Send: /newbot");
  io.print('  3. Follow its prompts (pick a name, and a username ending in "bot")');
  io.print("  4. Copy the token it gives you (looks like 123456789:AAExample-Token)");
  io.print("");

  let botToken = "";
  for (;;) {
    botToken = (await io.ask("Paste your bot token here: ")).trim();
    if (!botToken) {
      io.print("Token can't be empty.");
      continue;
    }
    io.print("Checking token...");
    try {
      const me = await verifyToken(botToken);
      io.print(`✓ Connected as @${me.username}`);
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retry = await io.ask(`✗ Couldn't verify that token (${message}). Try again? (Y/n) `);
      if (isNo(retry)) {
        io.print("Continuing with an unverified token — you can fix it later in the config file.");
        break;
      }
    }
  }

  io.print("");
  io.print("Step 2 of 3: AI provider");
  io.print("  The shell command img-to-post runs to turn an image into post text.");
  io.print('  Examples: "claude -p", "mycli --pipe --once", or a path to your own script.');
  io.print("");
  const aiCommand = (await io.ask("AI command [claude -p]: ")).trim() || "claude -p";

  io.print("");
  io.print("Step 3 of 3: Default topic");
  const defaultTopic = (await io.ask("Default topic name [tech]: ")).trim() || "tech";
  const variantsInput = (await io.ask("How many post variants per image? [1]: ")).trim();
  const variants = Number.parseInt(variantsInput, 10);

  const config: Omit<Config, "configDir"> = {
    telegram: { botToken },
    defaultTopic,
    ai: {
      default: "default",
      providers: {
        default: { command: aiCommand, timeoutSec: 120 },
      },
    },
    topics: {
      [defaultTopic]: {
        description: `image -> ${defaultTopic} post`,
        promptFile: `prompts/${defaultTopic}.txt`,
        variants: Number.isInteger(variants) && variants > 0 ? variants : 1,
      },
    },
  };

  const promptsDir = join(dirname(configPath), "prompts");
  const promptPath = join(promptsDir, `${defaultTopic}.txt`);
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(promptPath, STARTER_PROMPT);

  io.print("");
  io.print(`✓ Wrote ${configPath}`);
  io.print(`✓ Wrote ${promptPath}`);
  io.print("");
  io.print("Try it without Telegram first:");
  io.print(`  img-to-post post <image> ${defaultTopic}`);
  io.print("");
  io.print("Then run the bot:");
  io.print("  img-to-post bot");
}
