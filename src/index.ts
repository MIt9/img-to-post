#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { HELP } from "./help.ts";
import { loadConfig } from "./config.ts";
import { initCommand } from "./commands/init.ts";
import { topicsCommand } from "./commands/topics.ts";
import { postCommand } from "./commands/post.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
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
    case "topics":
      topicsCommand(loadConfig(configPath));
      return;
    case "post": {
      const [imagePath, topic] = positionals;
      if (!imagePath) fail("usage: img-to-post post <image> [topic]");
      await postCommand(loadConfig(configPath), process.cwd(), imagePath, topic);
      return;
    }
    case "bot":
    case "queue":
      fail(`"${command}" is not implemented yet.`);
    default:
      fail(`Unknown command: "${command}". Run "img-to-post --help" for usage.`);
  }
}

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
