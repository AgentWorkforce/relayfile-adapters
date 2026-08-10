export const SHORTCUT_LAYOUT_PROMPT = `# Shortcut Mount Layout

Shortcut records are stored under /shortcut. Canonical records use the stable Shortcut public id as the filename; use the indexes or by-id aliases to discover records instead of guessing names.

## Tree

- /shortcut/stories/<id>.json — story records
- /shortcut/epics/<id>.json — epic records
- Each collection has _index.json and by-id/<id>.json aliases.

Writable discovery contracts:

- discovery/shortcut/stories/.schema.json and .create.example.json
- discovery/shortcut/epics/.schema.json and .create.example.json

Terminal lifecycle fields such as archived, completed, completed_at, epic_state_id, and workflow_state_id remain on canonical records. Only an explicit Shortcut delete action removes a record.
`;

export function layoutPromptFile() {
  return {
    path: "/shortcut/LAYOUT.md",
    contentType: "text/markdown; charset=utf-8" as const,
    content: SHORTCUT_LAYOUT_PROMPT.endsWith("\n") ? SHORTCUT_LAYOUT_PROMPT : `${SHORTCUT_LAYOUT_PROMPT}\n`,
  };
}
