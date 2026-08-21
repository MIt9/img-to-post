import { test, expect } from "bun:test";
import { updateCommand } from "../src/commands/update.ts";

test("updateCommand is defined as an async function", () => {
  expect(typeof updateCommand).toBe("function");
});
