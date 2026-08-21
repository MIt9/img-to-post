#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { HELP } from "./help.ts";
import { loadConfig } from "./config.ts";
import { initCommand } from "./commands/init.ts";
import { topicsCommand } from "./commands/topics.ts";
import { postCommand } from "./commands/post.ts";
import { queueCommand } from "./commands/queue.ts";
import { runSetupWizard, createStdioWizardIO } from "./commands/setup.ts";
import { updateCommand } from "./commands/update.ts";
import { runBot } from "./bot.ts";
import { TelegramClient } from "./telegram.ts";

import { VERSION } from "./version.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(`img-to-post v${VERSION}`);
    return;
  }

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (rest.includes("--version") || rest.includes("-v")) {
    console.log(`img-to-post v${VERSION}`);
    return;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(HELP);
    return;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    options: { config: { type: "string" } },
    allowPositionals: true,
    strict: false,
  });
  const configPath = typeof values.config === "string" ? values.config : undefined;

  switch (command) {
    case "init":
      initCommand(process.cwd(), configPath);
      return;
    case "setup": {
      const io = await createStdioWizardIO();
      try {
        await runSetupWizard(process.cwd(), io, configPath);
      } finally {
        io.close();
      }
      return;
    }
    case "topics":
      topicsCommand(loadConfig(configPath));
      return;
    case "post": {
      const [imagePath, topic] = positionals;
      if (!imagePath) fail("usage: img-to-post post <image> [topic]");
      await postCommand(loadConfig(configPath), process.cwd(), imagePath, topic);
      return;
    }
    case "bot": {
      const config = loadConfig(configPath);
      if (!config.telegram.botToken) {
        fail('Config is missing "telegram.botToken" — set it in img-to-post.config.json or IMG2POST_TELEGRAM_BOT_TOKEN.');
      }
      const tg = new TelegramClient(config.telegram.botToken);
      await runBot(config, process.cwd(), tg);
      return;
    }
    case "queue": {
      const [action, id] = positionals;
      if (!action) fail("usage: img-to-post queue list|pause|resume|cancel <id>");
      queueCommand(process.cwd(), action, id);
      return;
    }
    case "update":
      await updateCommand();
      return;
    default:
      fail(`Unknown command: "${command}". Run "img-to-post --help" for usage.`);
  }
}

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
