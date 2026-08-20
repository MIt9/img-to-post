#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { HELP } from "./help.ts";
import { loadConfig, ConfigError } from "./config.ts";
import { initCommand } from "./commands/init.ts";
import { topicsCommand } from "./commands/topics.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  const { values } = parseArgs({
    args: rest,
    options: { config: { type: "string" } },
    allowPositionals: true,
  });

  switch (command) {
    case "init":
      initCommand(process.cwd());
      return;
    case "topics":
      topicsCommand(loadConfig(values.config));
      return;
    case "bot":
    case "post":
    case "queue":
      fail(`"${command}" is not implemented yet.`);
      return;
    default:
      fail(`Unknown command: "${command}". Run "img-to-post --help" for usage.`);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof ConfigError) fail(err.message);
  fail(err instanceof Error ? err.message : String(err));
}
