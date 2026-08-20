const CLEAN_SLUG = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

function sanitize(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveSlug(aiOutput: string, sourceFilename: string): string {
  const firstLine = (aiOutput.split("\n")[0] ?? "").trim();
  const candidate = firstLine.replace(/^SLUG:\s*/i, "").trim();
  if (candidate && CLEAN_SLUG.test(candidate)) {
    return sanitize(candidate);
  }
  return sanitize(sourceFilename);
}
