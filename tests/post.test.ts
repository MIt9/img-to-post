import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/types.ts";
import { postCommand } from "../src/commands/post.ts";
import { formatFolderDate } from "../src/output.ts";

let cwd: string;
let configDir: string;
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function fixture(script: string): string {
  configDir = mkdtempSync(join(tmpdir(), "img2post-post-"));
  const path = join(configDir, "fixture.sh");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

function baseConfig(script: string, variants?: number): Config {
  return {
    telegram: { botToken: "t" },
    defaultTopic: "tech",
    ai: { default: "mycli", providers: { mycli: { command: [script], timeoutSec: 5 } } },
    topics: { tech: { description: "d", promptFile: "prompt.txt", ...(variants !== undefined ? { variants } : {}) } },
    configDir,
  };
}

function setupImage(): string {
  cwd = mkdtempSync(join(tmpdir(), "img2post-post-cwd-"));
  const imagePath = join(cwd, "meme.jpg");
  writeFileSync(imagePath, "bytes");
  return imagePath;
}

test("variants: 3 produces exactly 3 post files from 3 separate subprocess calls", async () => {
  const script = fixture(
    `#!/bin/sh\ncount_file="$(dirname "$0")/count"\n` +
      `n=$(cat "$count_file" 2>/dev/null || echo 0)\nn=$((n+1))\necho "$n" > "$count_file"\n` +
      `echo "SLUG: multi-variant-post"\necho ""\necho "call number $n"\n`,
  );
  writeFileSync(join(configDir, "prompt.txt"), "p");
  const imagePath = setupImage();
  const config = baseConfig(script, 3);

  await postCommand(config, cwd, imagePath, "tech");

  const dir = join(cwd, "posts", `${formatFolderDate()}_multi-variant-post`);
  expect(existsSync(join(dir, "meme.jpg"))).toBe(true);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8").trim()).toBe("call number 1");
  expect(readFileSync(join(dir, "post-2.md"), "utf-8").trim()).toBe("call number 2");
  expect(readFileSync(join(dir, "post-3.md"), "utf-8").trim()).toBe("call number 3");
  expect(existsSync(join(dir, "post-4.md"))).toBe(false);
});

test("no variants field (default 1) writes a single post-1.md", async () => {
  const script = fixture(`#!/bin/sh\necho "SLUG: default-variant"\necho ""\necho "only call"\n`);
  writeFileSync(join(configDir, "prompt.txt"), "p");
  const imagePath = setupImage();
  const config = baseConfig(script);

  await postCommand(config, cwd, imagePath, "tech");

  const dir = join(cwd, "posts", `${formatFolderDate()}_default-variant`);
  expect(readFileSync(join(dir, "post-1.md"), "utf-8").trim()).toBe("only call");
  expect(existsSync(join(dir, "post-2.md"))).toBe(false);
});

test("a failing call among the N leaves no folder at all", async () => {
  const script = fixture(
    `#!/bin/sh\ncount_file="$(dirname "$0")/count"\nn=$(cat "$count_file" 2>/dev/null || echo 0)\nn=$((n+1))\n` +
      `echo "$n" > "$count_file"\nif [ "$n" -eq 2 ]; then echo "boom" >&2; exit 1; fi\n` +
      `echo "SLUG: should-not-exist"\necho ""\necho "call $n"\n`,
  );
  writeFileSync(join(configDir, "prompt.txt"), "p");
  const imagePath = setupImage();
  const config = baseConfig(script, 3);

  await expect(postCommand(config, cwd, imagePath, "tech")).rejects.toThrow();

  expect(existsSync(join(cwd, "posts"))).toBe(false);
});
