export const HELP = `img-to-post — turn images into posts via an external AI CLI

Usage:
  img-to-post <command> [options]

Commands:
  bot                     Run the Telegram long-poll bot
  init                    Scaffold img-to-post.config.json + prompts/ in the current directory
  post <image> [topic]    Generate a post from a local image
  topics                  List configured topics
  queue                   Inspect/manage the processing queue (not implemented yet)

Options:
  --config <path>         Path to config file (default: ./img-to-post.config.json)
  --help, -h               Show this help

Environment:
  IMG2POST_CONFIG                 Override config file path
  IMG2POST_TELEGRAM_BOT_TOKEN     Override telegram.botToken
  IMG2POST_TELEGRAM_BOT_USERNAME  Override telegram.botUsername
  IMG2POST_AI_DEFAULT             Override ai.default
`;
