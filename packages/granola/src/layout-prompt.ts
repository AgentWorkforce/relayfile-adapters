export interface GranolaVfsFile {
  path: string;
  contentType: string;
  content: string;
}

export const GRANOLA_LAYOUT_PROMPT = `# Granola Mount Layout

\`/granola/\` mirrors synced Granola notes and folders as JSON.

## Tree

\`\`\`
/granola/
├── LAYOUT.md
├── _index.json
├── notes/
│   ├── _index.json                    ← note rows ({ id, title, updated, day, folderIds, canonicalPath })
│   ├── <note-id>.json                 ← canonical note payload
│   ├── by-id/<note-id>.json           ← lookup by id (payload wrapper)
│   ├── by-day/YYYY-MM-DD/_index.json  ← notes touched that day
│   └── by-folder/<folder-id>/_index.json
└── folders/
    ├── _index.json                    ← folder rows ({ id, title, parentFolderId, canonicalPath })
    ├── <folder-id>.json               ← canonical folder payload
    ├── by-id/<folder-id>.json         ← lookup by id (payload wrapper)
    └── by-parent/<folder-id>/_index.json
\`\`\`

## Discovery Contracts

Read discovery schemas before writeback:
- \`discovery/granola/notes/.schema.json\`
- \`discovery/granola/folders/.schema.json\`
`;

export function granolaLayoutPromptFile(): GranolaVfsFile {
  return {
    path: '/granola/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: GRANOLA_LAYOUT_PROMPT.endsWith('\n')
      ? GRANOLA_LAYOUT_PROMPT
      : `${GRANOLA_LAYOUT_PROMPT}\n`,
  };
}
