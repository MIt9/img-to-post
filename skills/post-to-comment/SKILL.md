---
name: post-to-comment
description: "Generate insightful, anti-AI-slop comments for LinkedIn posts and articles in the matching source language, with word count limits and Claude Code support."
---

# post-to-comment Skill

Use this skill when analyzing a post or article and generating high-quality, human-sounding comments for LinkedIn, Twitter, or professional blogs.

## Core Rules

1. **Strict Language Matching:** Automatically detect the source post's language (Ukrainian, English, German, etc.) and write ALL comment variants in that exact same language.
2. **Zero AI Slop & Sycophancy:**
   - Never start with empty praise ("Great post!", "Thanks for sharing!", "Чудовий допис!", "Дякую!").
   - Ban AI buzzwords: *delve*, *leverage*, *testament*, *pivotal*, *tapestry*, *landscape*, *занурюватися*, *є свідченням*, *поворотний момент*.
   - Avoid throat-clearing reveals ("Here's my take:", "Ось моя думка:").
3. **Word Count Limits:** Keep comments concise and direct (default 40-70 words or `--max-words <n>`).

## CLI Usage

```bash
# Generate 3 professional comments for text directly
post-to-comment "We reduced deploy times by 40% using custom Bun plugins."

# Generate comments for a post file with word limit (e.g. max 50 words)
post-to-comment post.txt -w 50

# Output comments as JSON array for AI pipeline consumption
post-to-comment post.txt --json

# Save engineer persona comments to a file
post-to-comment post.txt engineer -n 3 -o comments.md

# Update to latest release
post-to-comment update
```

## Options

- `--persona <key>`: Persona key from config (`professional`, `engineer`)
- `--count, -n <number>`: Number of comment variants (default: 3)
- `--max-words, -w <number>`: Maximum word count limit per comment
- `--out, -o <file>`: Output file path (default: stdout)
- `--json`: Output as JSON array `["variant1", "variant2", "variant3"]`
