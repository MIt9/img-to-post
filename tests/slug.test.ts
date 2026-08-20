import { test, expect } from "bun:test";
import { deriveSlug } from "../src/slug.ts";

test("uses clean first line as slug", () => {
  expect(deriveSlug("rsc learning curve\nrest of post...", "meme.jpg")).toBe("rsc-learning-curve");
});

test("strips SLUG: prefix", () => {
  expect(deriveSlug("SLUG: react server components\nbody", "meme.jpg")).toBe("react-server-components");
});

test("falls back to sanitized filename when first line isn't a clean slug", () => {
  expect(deriveSlug("😀 not a slug! full sentence.", "My Meme File.jpg")).toBe("my-meme-file");
});

test("falls back to filename when AI output is empty", () => {
  expect(deriveSlug("", "weird_name!!.png")).toBe("weird-name");
});
