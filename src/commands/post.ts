import type { Config } from "../types.ts";
import { generatePost } from "../generate.ts";

export async function postCommand(config: Config, cwd: string, imagePath: string, topicKey?: string): Promise<void> {
  const { dir } = await generatePost(config, cwd, imagePath, topicKey);
  console.log(`Saved to ${dir}`);
}
