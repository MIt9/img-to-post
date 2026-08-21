export const ANTI_SLOP_PROMPT_INSTRUCTIONS = `
SYSTEM DIRECTIVE (ANTI-AI SLOP / БЕЗ AI-СЛОПУ):
Write naturally and directly like a human. Avoid all predictable AI writing patterns in any language (English, Ukrainian, etc.):
1. BANNED WORDS & BUZZWORDS / ЗАБОРОНЕНІ СЛОВА:
   - English: delve, foster, leverage, utilize, tapestry, pivotal, crucial, testament, landscape, realm, multifaceted, embark, game-changer, vibrant.
   - Ukrainian: занурюватися / поринати ("Давайте зануримося"), є свідченням, поворотний / ключовий момент, ландшафт, багатогранний, важелі / використовувати, варто підкреслити / зазначити, сприяти.
2. NO THROAT-CLEARING OPENERS / БЕЗ ВСТУПІВ-ЗАЗИВАЛОК:
   - Avoid "In today's fast-paced world...", "Let's dive in...", "Here's what you need to know...", "У сучасному швидкоплинному світі...", "Не секрет, що...", "Ось що вам потрібно знати...".
3. NO BINARY CONTRASTS & FAUX DRAMA / БЕЗ БІНАРНИХ КОНТРАСТІВ:
   - Avoid "It's not just X, it's Y" ("Це не просто X, це Y"). State Y directly.
   - Avoid "The best part:", "Here's the thing:".
4. NO TRAILING PARTICIPLE FLUFF / БЕЗ ДІЄПРИСЛІВНИКОВОГО СЛОПУ:
   - Avoid superficial trailing analysis like "...highlighting...", "...underscoring...", "...підкреслюючи...", "...забезпечуючи...".
5. CLEAN FORMATTING / ЧИСТЕ ФОРМАТУВАННЯ:
   - Keep emojis minimal (max 1-2 overall, do not put emojis on every line/bullet).
   - Use active voice, simple verbs (is/are/є/має), and varied sentence lengths.
`;

export function appendAntiSlopInstructions(prompt: string): string {
  if (prompt.includes("ANTI-AI SLOP") || prompt.includes("БЕЗ AI-СЛОПУ")) {
    return prompt;
  }
  return `${prompt.trim()}\n\n${ANTI_SLOP_PROMPT_INSTRUCTIONS.trim()}`;
}

export function sanitizeAntiSlop(text: string): string {
  if (!text) return text;
  let clean = text;

  // 1. Remove throat-clearing openers (English & Ukrainian)
  const openerRegexes = [
    /^(let's dive in|in today's (fast-paced )?world|here's what you need to know|here's the thing)[,!.:]?\s*/i,
    /^(у сучасному (швидкоплинному )?(світі|ландшафті|світі технологій)|давайте (зануримося|розглянемо)|не секрет, що|ось що вам потрібно знати)[,!.:]?\s*/i,
  ];

  for (const regex of openerRegexes) {
    clean = clean.replace(regex, "");
  }

  // 2. Fix binary contrast patterns: "It's not just X, it's Y" / "Це не просто X, це Y"
  clean = clean.replace(/(?:it's|it is) not (?:just|only) (.+?), (?:it's|it is) (.+?)\./gi, "$2.");
  clean = clean.replace(/це не просто (.+?), це (.+?)\./gi, "$2.");

  // 3. Remove em-dash (—) overuse by replacing with comma/period
  clean = clean.replace(/\s*—\s*/g, ", ");

  // 4. Remove fake-profound kickers / summary clichés at the very end
  const summaryEndingRegexes = [
    /\n+(exciting times lie ahead|the future looks bright|the best is yet to come|this is just the beginning of the journey)[.!]*$/i,
    /\n+(майбутнє виглядає яскравим|це лише початок (шляху|історії)|попереду багато цікавого)[.!]*$/i,
  ];
  for (const regex of summaryEndingRegexes) {
    clean = clean.replace(regex, "");
  }

  // 5. Clean up redundant bold-colon bullet markers: "- **Header:** text" -> "- Header: text"
  clean = clean.replace(/^(\s*[-*])\s*\*\*(.*?):\*\*\s*/gm, "$1 $2: ");

  // 6. Clean up trailing participle fluff at sentence ends
  clean = clean.replace(/,\s*(підкреслюючи|забезпечуючи|відображаючи|highlighting|underscoring|reflecting|showcasing)\s+[^.!\n]+([.!\n])/gi, "$2");

  // 7. Clean duplicate spaces and multiple blank lines
  clean = clean.replace(/ {2,}/g, " ");
  clean = clean.replace(/\n{3,}/g, "\n\n");

  return clean.trim();
}
