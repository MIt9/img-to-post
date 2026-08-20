import { test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProvider } from "../src/ai.ts";

function fixture(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "img2post-ai-"));
  const path = join(dir, "fixture.sh");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

test("captures stdout on success, passing image path and prompt as positional args", async () => {
  const script = fixture(`#!/bin/sh\necho "post text: $1 $2"\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 5 },
    { imagePath: "/tmp/a.jpg", prompt: "write something" },
  );
  expect(result.ok).toBe(true);
  expect(result.stdout.trim()).toBe("post text: /tmp/a.jpg write something");
});

test("captures stderr and ok=false on non-zero exit", async () => {
  const script = fixture(`#!/bin/sh\necho "bad thing" >&2\nexit 1\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 5 },
    { imagePath: "/tmp/a.jpg", prompt: "p" },
  );
  expect(result.ok).toBe(false);
  expect(result.stderr.trim()).toBe("bad thing");
});

test("passes prompt via stdin when provider declares stdin:true, image path stays positional", async () => {
  const script = fixture(`#!/bin/sh\necho "img=$1"\ncat\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 5, stdin: true },
    { imagePath: "/tmp/a.jpg", prompt: "hello from stdin" },
  );
  expect(result.stdout.trim()).toBe("img=/tmp/a.jpg\nhello from stdin");
});

test("sets IMG2POST_IMAGE_PATH and IMG2POST_PROMPT env vars", async () => {
  const script = fixture(`#!/bin/sh\necho "$IMG2POST_IMAGE_PATH|$IMG2POST_PROMPT"\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 5 },
    { imagePath: "/tmp/a.jpg", prompt: "envcheck" },
  );
  expect(result.stdout.trim()).toBe("/tmp/a.jpg|envcheck");
});

test("times out hanging providers and kills the process", async () => {
  const script = fixture(`#!/bin/sh\nsleep 5\n`);
  const result = await runProvider(
    { command: [script], timeoutSec: 1 },
    { imagePath: "/tmp/a.jpg", prompt: "p" },
  );
  expect(result.ok).toBe(false);
  expect(result.stderr).toMatch(/timeout/i);
});

test("supports command as a space-separated string", async () => {
  const script = fixture(`#!/bin/sh\necho got-$1\n`);
  const result = await runProvider(
    { command: `${script}`, timeoutSec: 5 },
    { imagePath: "/tmp/a.jpg", prompt: "p" },
  );
  expect(result.ok).toBe(true);
  expect(result.stdout.trim()).toBe("got-/tmp/a.jpg");
});
