import { test, expect } from "bun:test";
import { appendAntiSlopInstructions, sanitizeAntiSlop } from "../src/antislop.ts";

test("appendAntiSlopInstructions adds instructions to prompt if missing", () => {
  const prompt = "Describe this image for a tech blog.";
  const result = appendAntiSlopInstructions(prompt);
  expect(result).toContain("Describe this image for a tech blog.");
  expect(result).toContain("ANTI-AI SLOP");
  expect(result).toContain("БЕЗ AI-СЛОПУ");
});

test("appendAntiSlopInstructions does not duplicate instructions if already present", () => {
  const prompt = "SYSTEM DIRECTIVE (ANTI-AI SLOP / БЕЗ AI-СЛОПУ):\nDescribe this image.";
  const result = appendAntiSlopInstructions(prompt);
  expect(result).toBe(prompt);
});

test("sanitizeAntiSlop removes English throat-clearing openers", () => {
  const input = "Let's dive in! This photo shows a modern workspace.";
  expect(sanitizeAntiSlop(input)).toBe("This photo shows a modern workspace.");
});

test("sanitizeAntiSlop removes Ukrainian throat-clearing openers", () => {
  const input = "Давайте зануримося! Це фото показує сучасний робочий простір.";
  expect(sanitizeAntiSlop(input)).toBe("Це фото показує сучасний робочий простір.");
});

test("sanitizeAntiSlop cleans binary contrasts in English and Ukrainian", () => {
  expect(sanitizeAntiSlop("It's not just a tool, it's a game changer.")).toBe("a game changer.");
  expect(sanitizeAntiSlop("Це не просто ноутбук, це ваш помічник.")).toBe("ваш помічник.");
});

test("sanitizeAntiSlop removes em-dashes and cleans up bold list headers", () => {
  const input = "- **Дизайн:** Новий графічний інтерфейс — розроблений для команду.";
  expect(sanitizeAntiSlop(input)).toBe("- Дизайн: Новий графічний інтерфейс, розроблений для команду.");
});

test("sanitizeAntiSlop removes summary cliché endings", () => {
  const input = "Сучасний дизайн інтер'єру.\n\nМайбутнє виглядає яскравим!";
  expect(sanitizeAntiSlop(input)).toBe("Сучасний дизайн інтер'єру.");
});
