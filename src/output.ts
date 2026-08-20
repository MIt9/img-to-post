import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export function formatFolderDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export function writePost(input: {
  cwd: string;
  imagePath: string;
  slug: string;
  date: string;
  variants: string[];
  topic?: string;
  targetDir?: string;
}): string {
  const postsDir = join(input.cwd, "posts");
  let dir = input.targetDir;
  if (!dir) {
    dir = join(postsDir, `${input.date}_${input.slug}`);
    let attempt = 2;
    while (existsSync(dir)) {
      dir = join(postsDir, `${input.date}_${input.slug}-${attempt}`);
      attempt++;
    }
  }

  mkdirSync(dir, { recursive: true });
  const ext = extname(input.imagePath) || ".jpg";
  const memePath = join(dir, `meme${ext}`);
  if (!existsSync(memePath)) {
    copyFileSync(input.imagePath, memePath);
  }

  const prefix = input.topic ? `post-${input.topic}` : "post";
  if (input.variants.length === 1) {
    const filename = input.topic ? `post-${input.topic}.md` : "post-1.md";
    writeFileSync(join(dir, filename), input.variants[0] ?? "");
  } else {
    input.variants.forEach((text, i) => {
      writeFileSync(join(dir, `${prefix}-${i + 1}.md`), text);
    });
  }

  return dir;
}
