export function routeTopic(
  caption: string | undefined,
  topics: Record<string, unknown>,
  defaultTopic: string,
): string {
  const match = caption?.match(/^\/(\S+)/);
  const key = match?.[1];
  return key !== undefined && Object.hasOwn(topics, key) ? key : defaultTopic;
}
