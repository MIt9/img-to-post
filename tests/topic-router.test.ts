import { test, expect } from "bun:test";
import { routeTopic } from "../src/topic-router.ts";

const topics = { tech: {}, life: {} };

test("matches a leading /word caption against a configured topic key", () => {
  expect(routeTopic("/tech", topics, "life")).toBe("tech");
});

test("matches a /word caption followed by more text", () => {
  expect(routeTopic("/life check this out", topics, "tech")).toBe("life");
});

test("falls back to defaultTopic when the caption doesn't match any topic key", () => {
  expect(routeTopic("/unknown", topics, "tech")).toBe("tech");
});

test("falls back to defaultTopic when there is no caption", () => {
  expect(routeTopic(undefined, topics, "tech")).toBe("tech");
});

test("falls back to defaultTopic when the caption has no leading slash", () => {
  expect(routeTopic("tech", topics, "tech")).toBe("tech");
});

test("falls back to defaultTopic for inherited-property-name captions not actually configured", () => {
  expect(routeTopic("/constructor", topics, "tech")).toBe("tech");
  expect(routeTopic("/toString", topics, "tech")).toBe("tech");
});
