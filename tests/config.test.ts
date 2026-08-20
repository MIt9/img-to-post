import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveConfigPath, ConfigError } from "../src/config.ts";

const ENV_KEYS = [
  "IMG2POST_CONFIG",
  "IMG2POST_TELEGRAM_BOT_TOKEN",
  "IMG2POST_TELEGRAM_BOT_USERNAME",
  "IMG2POST_AI_DEFAULT",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function writeConfig(dir: string): string {
  const config = {
    telegram: { botToken: "file-token" },
    defaultTopic: "tech",
    ai: { default: "mycli", providers: {} },
    topics: { tech: { description: "d", promptFile: "prompts/tech.txt", variants: 1 } },
  };
  const path = join(dir, "img-to-post.config.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

test("loads config from an explicit path and sets configDir", () => {
  const dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const path = writeConfig(dir);

  const config = loadConfig(path);

  expect(config.telegram.botToken).toBe("file-token");
  expect(config.defaultTopic).toBe("tech");
  expect(config.configDir).toBe(dir);

  rmSync(dir, { recursive: true, force: true });
});

test("throws a clear ConfigError when the file is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const missing = join(dir, "does-not-exist.json");

  expect(() => loadConfig(missing)).toThrow(ConfigError);

  rmSync(dir, { recursive: true, force: true });
});

test("throws a clear ConfigError on invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const path = join(dir, "img-to-post.config.json");
  writeFileSync(path, "{ not json");

  expect(() => loadConfig(path)).toThrow(ConfigError);

  rmSync(dir, { recursive: true, force: true });
});

test("env vars override file values", () => {
  const dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const path = writeConfig(dir);
  process.env.IMG2POST_TELEGRAM_BOT_TOKEN = "env-token";
  process.env.IMG2POST_TELEGRAM_BOT_USERNAME = "env-username";
  process.env.IMG2POST_AI_DEFAULT = "env-ai";

  const config = loadConfig(path);

  expect(config.telegram.botToken).toBe("env-token");
  expect(config.telegram.botUsername).toBe("env-username");
  expect(config.ai.default).toBe("env-ai");

  rmSync(dir, { recursive: true, force: true });
});

test("throws a clear ConfigError when required sections are missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const path = join(dir, "img-to-post.config.json");
  writeFileSync(path, JSON.stringify({ defaultTopic: "tech" }));

  expect(() => loadConfig(path)).toThrow(ConfigError);

  rmSync(dir, { recursive: true, force: true });
});

test("throws a clear ConfigError when a topic's variants is zero or negative", () => {
  const dir = mkdtempSync(join(tmpdir(), "img2post-"));
  const path = join(dir, "img-to-post.config.json");
  writeFileSync(
    path,
    JSON.stringify({
      telegram: { botToken: "t" },
      defaultTopic: "tech",
      ai: { default: "mycli", providers: {} },
      topics: { tech: { description: "d", promptFile: "prompts/tech.txt", variants: 0 } },
    }),
  );

  expect(() => loadConfig(path)).toThrow(ConfigError);

  rmSync(dir, { recursive: true, force: true });
});

test("resolveConfigPath prefers explicit arg, then IMG2POST_CONFIG, then default", () => {
  expect(resolveConfigPath("explicit.json")).toBe("explicit.json");

  process.env.IMG2POST_CONFIG = "from-env.json";
  expect(resolveConfigPath()).toBe("from-env.json");

  delete process.env.IMG2POST_CONFIG;
  expect(resolveConfigPath()).toBe("img-to-post.config.json");
});
