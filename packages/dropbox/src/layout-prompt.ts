export interface DropboxVfsFile {
  path: string;
  contentType: string;
  content: string;
}

export const DROPBOX_LAYOUT_PROMPT = `# Dropbox Mount Layout

\`/dropbox/\` mirrors Dropbox metadata only. File bytes are not synced into canonical files.

## Tree

\`\`\`
/dropbox/
├── LAYOUT.md
├── _index.json
├── files/
│   ├── _index.json
│   ├── <slug>__<id>.json              ← canonical file metadata
│   ├── by-id/<dropbox-id>.json
│   └── by-path/<path>.json
├── folders/
│   ├── _index.json
│   ├── <slug>__<id>.json              ← canonical folder metadata
│   ├── by-id/<dropbox-id>.json
│   └── by-path/<path>.json
├── shared-folders/
│   ├── _index.json
│   ├── <shared-folder-id>.json
│   └── by-id/<shared-folder-id>.json
└── shared-links/
    ├── _index.json
    ├── <shared-link-id>.json
    └── by-id/<shared-link-id>.json
\`\`\`

## Discovery Contracts

Read discovery schemas before writeback:
- \`discovery/dropbox/files/.schema.json\`
- \`discovery/dropbox/folders/.schema.json\`
- \`discovery/dropbox/shared-folders/.schema.json\`
- \`discovery/dropbox/shared-links/.schema.json\`

## Notes

- Canonical files are metadata only.
- File bytes should be fetched lazily via actions (for example, temporary link or download-by-path).
`;

export function dropboxLayoutPromptFile(): DropboxVfsFile {
  return {
    path: '/dropbox/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: DROPBOX_LAYOUT_PROMPT.endsWith('\n')
      ? DROPBOX_LAYOUT_PROMPT
      : `${DROPBOX_LAYOUT_PROMPT}\n`,
  };
}
