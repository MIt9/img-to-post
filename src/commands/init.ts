import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../types.ts";

const STARTER_PROMPT = "Write a short, punchy engineering-focused post based on this image.\n";

export function initCommand(cwd: string): void {
  const configPath = join(cwd, "img-to-post.config.json");
  const promptsDir = join(cwd, "prompts");
  const promptPath = join(promptsDir, "tech.txt");

  if (existsSync(configPath)) {
    console.log(`${configPath} already exists, skipping.`);
    return;
  }

  const config: Omit<Config, "configDir"> = {
    telegram: { botToken: "" },
    defaultTopic: "tech",
    ai: {
      default: "mycli",
      providers: {
        mycli: { command: "mycli --pipe --once", timeoutSec: 120 },
      },
    },
    topics: {
      tech: { description: "meme -> engineering post", promptFile: "prompts/tech.txt", variants: 1 },
    },
  };

  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(promptPath, STARTER_PROMPT);

  console.log(`Created ${configPath}`);
  console.log(`Created ${promptPath}`);
}
