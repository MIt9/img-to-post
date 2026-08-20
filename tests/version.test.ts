import { test, expect } from "bun:test";
import { VERSION } from "../src/version.ts";

test("VERSION is 0.5.1", () => {
  expect(VERSION).toBe("0.5.1");
});
