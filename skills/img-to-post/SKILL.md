---
name: img-to-post
description: "Turn images/memes into social media posts via an external AI CLI with built-in anti-slop filtering for Ukrainian and English."
---

# img-to-post Skill

Use this skill when processing an image or meme to generate formatted, anti-AI-slop social media posts (for Telegram, LinkedIn, or Twitter).

## Core Rules

1. **Anti-AI Slop:** Automatically enriches prompts and sanitizes output text to eliminate AI clichés (*delve*, *testament*, *pivotal*, *поринати*, *є свідченням*), throat-clearing openers (*"Let's dive in"*, *"У сучасному світі"*), binary contrasts (*"Not X, but Y"*), and formatting clutter.
2. **Topic Routing:** Automatically route images based on caption (`/tech`, `/ai-news`) or fan out to all topics (`/all`).
3. **Clean Folder Layout:** Posts are saved as `posts/YYYY-MM-DD_HH-MM-SS/` containing `meme.<ext>` and `post-1.md`, `post-2.md`, ...

## CLI Usage

```bash
# Run the Telegram long-poll bot (foreground)
img-to-post bot

# Interactive setup wizard
img-to-post setup

# Generate post for a local image
img-to-post post meme.png tech

# List configured topics
img-to-post topics

# Manage background queue
img-to-post queue list
img-to-post queue pause <id>
img-to-post queue resume <id>
img-to-post queue cancel <id>

# Self-update to latest release from GitHub
img-to-post update
```

## Options

- `--config <path>`: Path to config file (default: `./img-to-post.config.json`)
- `--version, -v`: Show version
- `--help, -h`: Show help text
