import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export function writePost(input: {
  cwd: string;
  imagePath: string;
  slug: string;
  date: string;
  variants: string[];
}): string {
  const postsDir = join(input.cwd, "posts");
  let dir = join(postsDir, `${input.date}_${input.slug}`);
  let attempt = 2;
  while (existsSync(dir)) {
    dir = join(postsDir, `${input.date}_${input.slug}-${attempt}`);
    attempt++;
  }

  mkdirSync(dir, { recursive: true });
  const ext = extname(input.imagePath) || ".jpg";
  copyFileSync(input.imagePath, join(dir, `meme${ext}`));
  input.variants.forEach((text, i) => {
    writeFileSync(join(dir, `post-${i + 1}.md`), text);
  });

  return dir;
}
