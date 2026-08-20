import type { Config } from "../types.ts";

export function topicsCommand(config: Config): void {
  const entries = Object.entries(config.topics);
  if (entries.length === 0) {
    console.log("No topics configured.");
    return;
  }
  for (const [key, topic] of entries) {
    console.log(`${key}\t${topic.description}`);
  }
}
