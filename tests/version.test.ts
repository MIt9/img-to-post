import { test, expect } from "bun:test";
import { VERSION } from "../src/version.ts";

test("VERSION is 0.6.0", () => {
  expect(VERSION).toBe("0.6.0");
});
