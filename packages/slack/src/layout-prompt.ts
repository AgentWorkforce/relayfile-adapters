export const SLACK_LAYOUT_PROMPT = `# Slack Mount Layout

Always run \`ls\` before constructing a path. v2 standardizes resource directory names to \`<id>__<slug>\` (the Slack id first, then a sanitized name slug), so consumers should inspect the live tree rather than assuming a filename.

## Tree

\`/slack/LAYOUT.md\` is this guide.
\`/slack/_index.json\` lists top-level resource roots (\`channels\`, \`users\`, etc).
\`/slack/channels/_index.json\` and \`/slack/users/_index.json\` enumerate every channel and user with row \`{ id, title, updated }\` (plus \`is_bot\` for users).
\`/slack/channels/<channelId>__<channelName>/\` owns per-channel records:
  - \`meta.json\`         — canonical channel record.
  - \`messages/<ts>/meta.json\` — canonical top-level message records. Message text is mutable, so the stable Slack timestamp is the directory key.
  - \`threads/<ts>/meta.json\` and \`threads/<ts>/replies/<ts>.json\` — thread roots and replies.
  - \`messages/<ts>/reactions/<emoji>--<userId>.json\` — reaction records.
\`/slack/users/<userId>__<userName>/meta.json\` — canonical user record.
\`/slack/users/by-name/<slug>.json\` and \`/slack/channels/by-name/<slug>.json\` — name-keyed alias files pointing to canonical records. Collisions are disambiguated with a short id-derived hash suffix (e.g. \`sam-3b1a9f7c.json\`).
\`/slack/users/bots/<userId>__<userName>.json\` — alias subtree of bot users only, for \`ls\`-style discovery.
\`/discovery/slack/channels/_index.json\` and \`/discovery/slack/users/_index.json\` are history-independent lookup indexes for writeback context. They are populated from Slack channel/user discovery syncs and can be mounted even when historical records under \`/slack/channels/**\` or \`/slack/users/**\` are not mounted.

When either the channel name or the user/file name is missing, the directory segment falls back to the bare id (\`<channelId>\`, \`<userId>\`) — the slug suffix is only appended when a non-empty name is available.

## Indexes

\`/slack/_index.json\`:

\`\`\`json
[
  { "name": "channels", "path": "/slack/channels" },
  { "name": "users", "path": "/slack/users" }
]
\`\`\`

\`/slack/channels/_index.json\` rows:

\`\`\`json
{ "id": "C0ADE9B71CN", "title": "general", "updated": "<iso8601>" }
\`\`\`

\`/slack/users/_index.json\` rows:

\`\`\`json
{ "id": "U0123ABCDEF", "title": "Sam Carter", "updated": "<iso8601>", "is_bot": false }
\`\`\`

The \`is_bot\` flag lets you list humans without opening every user record:
\`jq '.[] | select(.is_bot | not)' /slack/users/_index.json\`.

## Discovery Lookup Indexes

When historical data is disabled, read \`/discovery/slack/channels/_index.json\` before posting a channel message and \`/discovery/slack/users/_index.json\` before posting a direct message. These files contain the same id/name lookup context as the historical indexes, but they live under \`discovery/\` so agents can resolve Slack ids without mounting message history.

\`/discovery/slack/channels/_index.json\` rows:

\`\`\`json
{
  "id": "C0ADE9B71CN",
  "name": "general",
  "title": "general",
  "updated": "2026-06-05T00:00:00.000Z",
  "path": "/slack/channels/C0ADE9B71CN__general",
  "messagesPath": "/slack/channels/C0ADE9B71CN__general/messages"
}
\`\`\`

\`/discovery/slack/users/_index.json\` rows:

\`\`\`json
{
  "id": "U0123ABCDEF",
  "name": "sam",
  "title": "Sam Carter",
  "updated": "2026-06-05T00:00:00.000Z",
  "path": "/slack/users/U0123ABCDEF__sam",
  "messagesPath": "/slack/users/U0123ABCDEF__sam/messages",
  "is_bot": false
}
\`\`\`

## Back-compat: \`message.json\` → \`meta.json\`

adapter-slack \`<= 0.2.2\` wrote messages to \`messages/<ts>/message.json\`. v2 writes \`messages/<ts>/meta.json\`. Readers that may encounter either form should try the canonical \`meta.json\` first and fall back to \`message.json\`; see \`slackMessageReadCandidatePaths()\` in \`@relayfile/adapter-slack/path-mapper\`.

## JSONL And Querying

Slack does not emit JSONL in this adapter today. Canonical records are JSON files; \`_index.json\` files are plain JSON arrays. Examples:

\`\`\`bash
ls /slack/channels
jq '.[0]' /slack/channels/_index.json
ls /slack/users/bots                                     # every bot user
jq '.[] | select(.is_bot | not) | .title' /slack/users/_index.json
cat /slack/channels/by-name/general.json                 # alias → canonical channel
\`\`\`
`;

export function slackLayoutPromptFile() {
  return {
    path: '/slack/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: SLACK_LAYOUT_PROMPT.endsWith('\n') ? SLACK_LAYOUT_PROMPT : `${SLACK_LAYOUT_PROMPT}\n`,
  };
}
