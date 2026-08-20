import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePost } from "../src/output.ts";

let cwd: string;
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function setup(): { cwd: string; imagePath: string } {
  cwd = mkdtempSync(join(tmpdir(), "img2post-out-"));
  const imagePath = join(cwd, "meme.jpg");
  writeFileSync(imagePath, "fake-image-bytes");
  return { cwd, imagePath };
}

test("creates dated slug folder with copied image and a single post-1.md for one variant", () => {
  const { cwd, imagePath } = setup();
  const dir = writePost({ cwd, imagePath, slug: "rsc-learning-curve", date: "2026-08-20", variants: ["post body"] });
  expect(dir).toBe(join(cwd, "posts", "2026-08-20_rsc-learning-curve"));
  expect(existsSync(join(dir, "meme.jpg"))).toBe(true);
  expect(readFileSync(join(dir, "meme.jpg"), "utf-8")).toBe("fake-image-bytes");
  expect(readFileSync(join(dir, "post-1.md"), "utf-8")).toBe("post body");
});

test("writes one post-N.md file per variant", () => {
  const { cwd, imagePath } = setup();
  const dir = writePost({
    cwd,
    imagePath,
    slug: "rsc-learning-curve",
    date: "2026-08-20",
    variants: ["first", "second", "third"],
  });
  expect(readFileSync(join(dir, "post-1.md"), "utf-8")).toBe("first");
  expect(readFileSync(join(dir, "post-2.md"), "utf-8")).toBe("second");
  expect(readFileSync(join(dir, "post-3.md"), "utf-8")).toBe("third");
  expect(existsSync(join(dir, "post-4.md"))).toBe(false);
});

test("preserves the source image's extension", () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-out-"));
  const imagePath = join(cwd, "input.png");
  writeFileSync(imagePath, "bytes");
  const dir = writePost({ cwd, imagePath, slug: "slug", date: "2026-08-20", variants: ["t"] });
  expect(existsSync(join(dir, "meme.png"))).toBe(true);
});

test("appends -2, -3 on folder name collision instead of overwriting", () => {
  const { cwd, imagePath } = setup();
  mkdirSync(join(cwd, "posts", "2026-08-20_rsc-learning-curve"), { recursive: true });
  mkdirSync(join(cwd, "posts", "2026-08-20_rsc-learning-curve-2"), { recursive: true });
  const dir = writePost({ cwd, imagePath, slug: "rsc-learning-curve", date: "2026-08-20", variants: ["x"] });
  expect(dir).toBe(join(cwd, "posts", "2026-08-20_rsc-learning-curve-3"));
});
