import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupWizard } from "../src/commands/setup.ts";

let cwd: string;
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function fakeIo(answers: string[]) {
  const printed: string[] = [];
  let i = 0;
  return {
    printed,
    ask: async (_prompt: string) => {
      const answer = answers[i] ?? "";
      i += 1;
      return answer;
    },
    print: (line: string) => {
      printed.push(line);
    },
    close: () => {},
  };
}

test("happy path: verified token, custom AI command/topic/variants -> writes config + prompt", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const io = fakeIo(["123:TOKEN", "./my-ai.sh", "life", "3"]);
  const verify = async (token: string) => {
    expect(token).toBe("123:TOKEN");
    return { username: "my_bot" };
  };

  await runSetupWizard(cwd, io, undefined, verify);

  const config = JSON.parse(readFileSync(join(cwd, "img-to-post.config.json"), "utf-8"));
  expect(config.telegram.botToken).toBe("123:TOKEN");
  expect(config.defaultTopic).toBe("life");
  expect(config.ai.providers[config.ai.default].command).toBe("./my-ai.sh");
  expect(config.topics.life.variants).toBe(3);
  expect(existsSync(join(cwd, "prompts", "life.txt"))).toBe(true);
  expect(io.printed.some((l) => l.includes("Connected as @my_bot"))).toBe(true);
});

test("empty token is rejected and re-asked until non-empty", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const io = fakeIo(["", "  ", "123:TOKEN", "", "", ""]);
  const verify = async () => ({ username: "bot" });

  await runSetupWizard(cwd, io, undefined, verify);

  const config = JSON.parse(readFileSync(join(cwd, "img-to-post.config.json"), "utf-8"));
  expect(config.telegram.botToken).toBe("123:TOKEN");
});

test("failed verification: retry with a valid token succeeds", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const io = fakeIo(["bad-token", "y", "good-token", "", "", ""]);
  let call = 0;
  const verify = async (token: string) => {
    call += 1;
    if (token === "bad-token") throw new Error("Unauthorized");
    return { username: "bot" };
  };

  await runSetupWizard(cwd, io, undefined, verify);

  expect(call).toBe(2);
  const config = JSON.parse(readFileSync(join(cwd, "img-to-post.config.json"), "utf-8"));
  expect(config.telegram.botToken).toBe("good-token");
});

test("failed verification: declining retry keeps the unverified token", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const io = fakeIo(["bad-token", "n", "", "", ""]);
  const verify = async () => {
    throw new Error("Unauthorized");
  };

  await runSetupWizard(cwd, io, undefined, verify);

  const config = JSON.parse(readFileSync(join(cwd, "img-to-post.config.json"), "utf-8"));
  expect(config.telegram.botToken).toBe("bad-token");
  expect(io.printed.some((l) => l.includes("unverified token"))).toBe(true);
});

test("defaults apply when the user just presses enter", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const io = fakeIo(["123:TOKEN", "", "", ""]);
  const verify = async () => ({ username: "bot" });

  await runSetupWizard(cwd, io, undefined, verify);

  const config = JSON.parse(readFileSync(join(cwd, "img-to-post.config.json"), "utf-8"));
  expect(config.defaultTopic).toBe("tech");
  expect(config.ai.providers[config.ai.default].command).toBe("claude -p");
  expect(config.topics.tech.variants).toBe(1);
});

test("existing config: declining overwrite leaves the file untouched", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const configPath = join(cwd, "img-to-post.config.json");
  const original = JSON.stringify({ marker: "original" });
  await Bun.write(configPath, original);
  const io = fakeIo(["n"]);
  const verify = async () => ({ username: "bot" });

  await runSetupWizard(cwd, io, undefined, verify);

  expect(readFileSync(configPath, "utf-8")).toBe(original);
});

test("existing config: accepting overwrite replaces it", async () => {
  cwd = mkdtempSync(join(tmpdir(), "img2post-setup-"));
  const configPath = join(cwd, "img-to-post.config.json");
  await Bun.write(configPath, JSON.stringify({ marker: "original" }));
  const io = fakeIo(["y", "123:TOKEN", "", "", ""]);
  const verify = async () => ({ username: "bot" });

  await runSetupWizard(cwd, io, undefined, verify);

  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  expect(config.telegram.botToken).toBe("123:TOKEN");
});
