export const TELEGRAM_LAYOUT_PROMPT = `# Telegram Mount Layout

Telegram is a Bot API integration. It can capture a rich event-sourced conversation history from the moment a bot is connected, but it cannot backfill arbitrary pre-existing chat history like Slack can. Incoming updates are delivered by Telegram through webhooks or getUpdates and are retained by Telegram for a limited time until received. Treat \`/telegram\` as the durable Relayfile history built from captured bot updates plus enrichment calls.

## BotFather Setup

Before connecting, create a bot in @BotFather with \`/newbot\` and use the token in the Nango Telegram connection. Enable inline queries with \`/setinline\`, choose the bot, and set the placeholder users see when typing \`@your_bot query\`. For group history, invite the bot to the group. If the bot must receive ordinary group messages instead of only commands, mentions, and replies, change privacy mode in @BotFather with \`/setprivacy\`. Reaction and member updates often require the bot to be an administrator and the webhook or poller to request the matching \`allowed_updates\`.

## Tree

\`/telegram/LAYOUT.md\` is this guide.
\`/telegram/_index.json\` lists top-level roots: \`bot\`, \`chats\`, \`callback-queries\`, \`inline-queries\`, and \`updates\`.
\`/telegram/bot/config.json\` is the latest bot configuration snapshot from \`getMe\`, command/menu/description reads, webhook info, and any configured sync toggles.
\`/telegram/chats/_index.json\` lists every chat seen or enriched by the bot with row \`{ id, title, updated }\` plus optional \`type\`, \`username\`, \`messageCount\`, and \`canonicalPath\`.
\`/telegram/chats/<chatId>__<title>/meta.json\` is the canonical chat record. When a title is unavailable, the directory falls back to the bare chat id.
\`/telegram/chats/<chatId>__<title>/messages/_index.json\` lists messages captured for that chat, sorted by \`updated\` descending.
\`/telegram/chats/<chatId>__<title>/messages/<messageId>/meta.json\` is a canonical message record. Message records are directories because reactions and future child artifacts live under the same message stem.
\`/telegram/chats/<chatId>__<title>/threads/<messageThreadId>/messages/<messageId>/meta.json\` is used for forum topic messages when Telegram provides a message thread id.
\`/telegram/chats/<chatId>__<title>/messages/<messageId>/reactions/<updateId>.json\` records reaction update payloads.
\`/telegram/callback-queries/<callbackQueryId>.json\` records inline keyboard callback queries.
\`/telegram/inline-queries/<inlineQueryId>.json\` records inline-mode queries.
\`/telegram/updates/<updateId>.json\` stores raw update envelopes when the history sync is enabled.

## Aliases

\`/telegram/chats/by-title/<slug>__<chatId>.json\` points to the canonical chat record. Title collisions append a deterministic id hash before the id suffix.
\`/telegram/chats/by-username/<username>__<chatId>.json\` points to public chats with usernames.
\`/telegram/messages/by-user/<userId>__<chatId>__<messageId>.json\` points to message records sent by a known user.
\`/telegram/callback-queries/by-data/<slug>__<callbackQueryId>.json\` points to callback queries by callback data.

Alias files are minimal pointers with \`{ id, canonicalPath, ... }\`; read the canonical path for full payloads.

## Index Examples

\`\`\`bash
ls /telegram
cat /telegram/bot/config.json
jq '.[0]' /telegram/chats/_index.json
ls /telegram/chats/by-title
jq '.[] | select(.type == "private")' /telegram/chats/_index.json
jq '.[0]' /telegram/chats/<chatId>/messages/_index.json
cat /telegram/callback-queries/by-data/approve__abc123.json
\`\`\`

## Writeback Discovery

Creates happen by writing JSON documents to non-canonical filenames in writable resource directories. Common resources are advertised under \`/discovery/telegram\`:

- \`/telegram/chats/{chatId}/messages\` for \`sendMessage\` and rich reply markup.
- \`/telegram/chats/{chatId}/messages/{messageId}/reactions\` for \`setMessageReaction\`.
- \`/telegram/callback-queries\` for \`answerCallbackQuery\`.
- \`/telegram/inline-queries\` for \`answerInlineQuery\`.
- \`/telegram/bot/commands\` for \`setMyCommands\`.
- \`/telegram/bot/menu-button\` for \`setChatMenuButton\`.

Discovery schemas are emitted at \`/discovery/telegram/chats/{chatId}/messages/.schema.json\`, \`/discovery/telegram/chats/{chatId}/messages/{messageId}/reactions/.schema.json\`, \`/discovery/telegram/callback-queries/.schema.json\`, \`/discovery/telegram/inline-queries/.schema.json\`, \`/discovery/telegram/bot/commands/.schema.json\`, and \`/discovery/telegram/bot/menu-button/.schema.json\`.

The Cloud/Nango runtime executes the Bot API call; the adapter owns path contracts, indexes, aliases, trigger names, and discovery schemas.
`;

export function telegramLayoutPromptFile() {
  return {
    path: '/telegram/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: TELEGRAM_LAYOUT_PROMPT.endsWith('\n')
      ? TELEGRAM_LAYOUT_PROMPT
      : `${TELEGRAM_LAYOUT_PROMPT}\n`,
  };
}
