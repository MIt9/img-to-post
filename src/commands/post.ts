import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../types.ts";
import { runProvider } from "../ai.ts";
import { deriveSlug } from "../slug.ts";
import { writePost } from "../output.ts";

export async function postCommand(config: Config, cwd: string, imagePath: string, topicKey?: string): Promise<void> {
  const key = topicKey ?? config.defaultTopic;
  const topic = config.topics[key];
  if (!topic) {
    throw new Error(`Unknown topic: "${key}"`);
  }

  const providerKey = topic.ai ?? config.ai.default;
  const provider = config.ai.providers[providerKey];
  if (!provider) {
    throw new Error(`Unknown AI provider: "${providerKey}"`);
  }

  const prompt = readFileSync(join(config.configDir, topic.promptFile), "utf-8");

  const result = await runProvider(provider, { imagePath, prompt });
  if (!result.ok) {
    throw new Error(result.stderr.trim() || "AI provider exited with a non-zero status");
  }

  const rawText = result.stdout.trim();
  const slug = deriveSlug(rawText, imagePath);
  const text = rawText.replace(/^SLUG:.*(\r?\n)+/i, "");
  const date = new Date().toISOString().slice(0, 10);
  const dir = writePost({ cwd, imagePath, slug, date, text });

  console.log(`Saved to ${dir}`);
}
