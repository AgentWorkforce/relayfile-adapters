export interface FathomVfsFile {
  path: string;
  contentType: string;
  content: string;
}

export const FATHOM_LAYOUT_PROMPT = `# Fathom Mount Layout

\`/fathom/\` mirrors synced Fathom meetings, recording-derived artifacts, teams, and team members as JSON.

## Tree

\`\`\`
/fathom/
├── LAYOUT.md
├── _index.json
├── meetings/
│   ├── _index.json                          ← rows { id, title, updated, canonicalPath }
│   ├── <recording-id>.json                  ← canonical meeting payload
│   └── by-id/<recording-id>.json            ← by-id alias wrapper
├── recording-summaries/
│   ├── _index.json                          ← rows for summary resources
│   └── by-id/<recording-id>.json            ← summary alias wrapper
├── recording-transcripts/
│   ├── _index.json                          ← rows for transcript resources
│   └── by-id/<recording-id>.json            ← transcript alias wrapper
├── recordings/
│   └── <recording-id>/
│       ├── summary.json                     ← canonical summary payload
│       └── transcript.json                  ← canonical transcript payload
├── teams/
│   ├── _index.json
│   ├── <team-id>.json
│   └── by-id/<team-id>.json
└── team-members/
    ├── _index.json
    ├── <member-id>.json
    └── by-id/<member-id>.json
\`\`\`

## Semantics

- Canonical meeting file id is the Fathom \`recording_id\` converted to string.
- Recording summary and transcript resources are anchored to the same recording id.
- Team and team-member ids are stable strings from sync models (team name or email).
- Alias files include \`canonicalPath\` and payload wrapper metadata for fast lookup.
- Fathom in Relayfile is read-only; this mount does not expose file-native writeback schemas.

## Quick commands

List latest meetings:
\`\`\`bash
jq '.[] | {id, title, updated}' /fathom/meetings/_index.json
\`\`\`

Open one summary:
\`\`\`bash
jq '.' /fathom/recordings/123456789/summary.json
\`\`\`

Resolve by-id alias to canonical path:
\`\`\`bash
jq '{id, canonicalPath}' /fathom/meetings/by-id/123456789.json
\`\`\`
`;

export function fathomLayoutPromptFile(): FathomVfsFile {
  return {
    path: '/fathom/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: FATHOM_LAYOUT_PROMPT.endsWith('\n') ? FATHOM_LAYOUT_PROMPT : `${FATHOM_LAYOUT_PROMPT}\n`,
  };
}
