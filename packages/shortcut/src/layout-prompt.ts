export const SHORTCUT_LAYOUT_PROMPT = `# Shortcut Mount Layout

Shortcut records are stored under /shortcut. Canonical records use the stable Shortcut public id as the filename; use the indexes or by-id aliases to discover records instead of guessing names.

## Tree

- /shortcut/categories/<id>.json — category records
- /shortcut/custom-fields/<id>.json — custom-field records
- /shortcut/epics/<id>.json — epic records
- /shortcut/groups/<id>.json — group records
- /shortcut/iterations/<id>.json — iteration records
- /shortcut/labels/<id>.json — label records
- /shortcut/members/<id>.json — member records
- /shortcut/milestones/<id>.json — milestone records
- /shortcut/projects/<id>.json — project records
- /shortcut/stories/<id>.json — story records
- /shortcut/workflows/<id>.json — workflow records
- Each collection has _index.json and by-id/<id>.json aliases.

Writable discovery contracts:

- discovery/shortcut/<resource>/.schema.json and .create.example.json for each writable collection

Terminal lifecycle fields such as archived, completed, completed_at, epic_state_id, and workflow_state_id remain on canonical records. Only an explicit Shortcut delete action removes a record.
`;

export function layoutPromptFile() {
  return {
    path: "/shortcut/LAYOUT.md",
    contentType: "text/markdown; charset=utf-8" as const,
    content: SHORTCUT_LAYOUT_PROMPT.endsWith("\n") ? SHORTCUT_LAYOUT_PROMPT : `${SHORTCUT_LAYOUT_PROMPT}\n`,
  };
}
