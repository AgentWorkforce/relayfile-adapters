export interface RecallVfsFile {
  path: string;
  contentType: string;
  content: string;
}

export const RECALL_LAYOUT_PROMPT = `# Recall Mount Layout

\`/recall/\` mirrors synced Recall recordings as JSON. Recording and transcript webhooks both resolve to a single canonical recording record so callers can subscribe to one tree and read transcript content from \`payload.transcript_text\`.

## Tree

\`\`\`
/recall/
├── LAYOUT.md
├── _index.json
└── recordings/
    ├── _index.json                       ← recording rows ({ id, title, updated, day, status, canonicalPath })
    ├── <recording-id>.json               ← canonical recording payload with transcript_text when available
    ├── by-id/<recording-id>.json         ← lookup by stable Recall recording id (payload wrapper)
    └── by-day/YYYY-MM-DD/_index.json     ← recordings updated or completed that day
\`\`\`

## Canonical Records

Canonical recording records live at \`/recall/recordings/{id}.json\`. Transcript events do not create a separate transcript subtree; they update the matching recording document and carry the flattened transcript on \`payload.transcript_text\` while preserving the raw provider payload under \`payload\`.

## Discovery Contracts

Read discovery schemas before writeback:
- \`discovery/recall/recordings/.schema.json\`

## Examples

\`\`\`bash
ls /recall/recordings
jq '.payload.transcript_text' /recall/recordings/<recording-id>.json
jq '.[0:10] | map({ id, title, updated, status })' /recall/recordings/_index.json
jq '.canonicalPath' /recall/recordings/by-id/<recording-id>.json
\`\`\`
`;

export function recallLayoutPromptFile(): RecallVfsFile {
  return {
    path: '/recall/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: RECALL_LAYOUT_PROMPT.endsWith('\n')
      ? RECALL_LAYOUT_PROMPT
      : `${RECALL_LAYOUT_PROMPT}\n`,
  };
}
