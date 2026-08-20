export const HELP = `img-to-post — turn images into posts via an external AI CLI

Usage:
  img-to-post <command> [options]

Commands:
  bot                     Run the Telegram long-poll bot
  setup                   Interactive wizard: walks you through the Telegram token, AI command, and topic
  init                    Non-interactive: scaffold img-to-post.config.json + prompts/ with placeholder values
  post <image> [topic]    Generate a post from a local image
  topics                  List configured topics
  queue list              List queued items and their status
  queue pause <id>        Prevent a pending item from being picked up
  queue resume <id>       Make a paused item eligible again
  queue cancel <id>       Remove an item from the queue entirely

Options:
  --config <path>         Path to config file (default: ./img-to-post.config.json)
  --help, -h               Show this help

Environment:
  IMG2POST_CONFIG                 Override config file path
  IMG2POST_TELEGRAM_BOT_TOKEN     Override telegram.botToken
  IMG2POST_TELEGRAM_BOT_USERNAME  Override telegram.botUsername
  IMG2POST_AI_DEFAULT             Override ai.default
`;
