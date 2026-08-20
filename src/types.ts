export interface ProviderConfig {
  command: string | string[];
  timeoutSec: number;
  stdin?: boolean;
}

export interface TopicConfig {
  description: string;
  promptFile: string;
  variants?: number;
  ai?: string;
}

export interface Config {
  telegram: { botToken: string; botUsername?: string };
  defaultTopic: string;
  ai: { default: string; providers: Record<string, ProviderConfig> };
  topics: Record<string, TopicConfig>;
  configDir: string;
}

export type QueueStatus = "pending" | "processing" | "completed" | "failed" | "paused";

export interface QueueItem {
  id: string;
  chatId: number;
  imagePath: string;
  topic: string;
  status: QueueStatus;
  createdAt: string;
  error?: string;
}

export interface ProviderResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
