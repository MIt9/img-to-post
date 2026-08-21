import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types.ts";
import { runProvider } from "./ai.ts";
import { deriveSlug } from "./slug.ts";
import { writePost, formatFolderDate } from "./output.ts";
import { appendAntiSlopInstructions, sanitizeAntiSlop } from "./antislop.ts";

export async function generatePost(
  config: Config,
  cwd: string,
  imagePath: string,
  topicKey?: string,
  targetDir?: string,
): Promise<{ dir: string; variants: string[] }> {
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

  const rawPrompt = readFileSync(join(config.configDir, topic.promptFile), "utf-8");
  const prompt = appendAntiSlopInstructions(rawPrompt);

  const variantCount = topic.variants ?? 1;
  const rawTexts: string[] = [];
  for (let i = 0; i < variantCount; i++) {
    const result = await runProvider(provider, { imagePath, prompt });
    if (!result.ok) {
      throw new Error(result.stderr.trim() || "AI provider exited with a non-zero status");
    }
    const sanitized = sanitizeAntiSlop(result.stdout.trim());
    rawTexts.push(sanitized);
  }

  const slug = deriveSlug(rawTexts[0] ?? "", imagePath);
  const variants = rawTexts.map((rawText) => rawText.replace(/^SLUG:.*(\r?\n)+/i, ""));
  const date = formatFolderDate();
  const dir = writePost({ cwd, imagePath, slug, date, variants, topic: key, targetDir });

  return { dir, variants };
}

