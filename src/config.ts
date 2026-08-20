import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Config } from "./types.ts";

export class ConfigError extends Error {}

export function resolveConfigPath(explicitPath?: string): string {
  return explicitPath ?? process.env.IMG2POST_CONFIG ?? "img-to-post.config.json";
}

export function loadConfig(explicitPath?: string): Config {
  const configPath = resolveConfigPath(explicitPath);

  if (!existsSync(configPath)) {
    throw new ConfigError(
      `Config file not found: ${configPath}\nRun "img-to-post init" to create one.`,
    );
  }

  let config: Config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
  } catch {
    throw new ConfigError(`Config file is not valid JSON: ${configPath}`);
  }

  if (
    typeof config.telegram !== "object" ||
    config.telegram === null ||
    typeof config.ai !== "object" ||
    config.ai === null ||
    typeof config.ai.providers !== "object" ||
    config.ai.providers === null ||
    typeof config.topics !== "object" ||
    config.topics === null
  ) {
    throw new ConfigError(
      `Config file is missing required sections (telegram, ai, ai.providers, topics): ${configPath}`,
    );
  }

  config.configDir = dirname(resolve(configPath));

  if (process.env.IMG2POST_TELEGRAM_BOT_TOKEN) {
    config.telegram.botToken = process.env.IMG2POST_TELEGRAM_BOT_TOKEN;
  }
  if (process.env.IMG2POST_TELEGRAM_BOT_USERNAME) {
    config.telegram.botUsername = process.env.IMG2POST_TELEGRAM_BOT_USERNAME;
  }
  if (process.env.IMG2POST_AI_DEFAULT) {
    config.ai.default = process.env.IMG2POST_AI_DEFAULT;
  }

  return config;
}
