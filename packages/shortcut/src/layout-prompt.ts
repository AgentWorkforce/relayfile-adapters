import { SHORTCUT_PATH_ROOT } from "./types.js";

export const SHORTCUT_LAYOUT_PROMPT = `# Shortcut Mount Layout

Shortcut records are stored under ${SHORTCUT_PATH_ROOT}. Flat canonical records use \`<slug>__<id>.json\` when a human-readable name is available; older id-only canonical paths remain readable for compatibility. Use the indexes or aliases to discover records instead of guessing names.

## Tree

- /shortcut/categories/<slug>__<id>.json — category records
- /shortcut/custom-fields/<slug>__<id>.json — custom-field records
- /shortcut/epics/<slug>__<id>.json — epic records
- /shortcut/groups/<slug>__<id>.json — group records
- /shortcut/iterations/<slug>__<id>.json — iteration records
- /shortcut/labels/<slug>__<id>.json — label records
- /shortcut/members/<slug>__<id>.json — member records
- /shortcut/milestones/<slug>__<id>.json — milestone records
- /shortcut/projects/<slug>__<id>.json — project records
- /shortcut/stories/<slug>__<id>.json — story records
- /shortcut/workflows/<slug>__<id>.json — workflow records
- Each collection has _index.json and materialized aliases whose bodies are byte-identical canonical record mirrors.
- Story and Epic records additionally expose by-title, by-state, by-assignee, by-creator, and by-priority aliases when the corresponding provider fields are present.
- Alias filenames use deterministic slug__id segments; collision variants add a stable id-derived suffix.
- Index rows are sorted by updated timestamp descending, then by stable id. Use \`jq '.[].canonicalPath' /shortcut/_index.json\` to inspect collection roots and \`jq '.[].id' /shortcut/stories/_index.json\` to inspect story ids.
- Examples: \`ls /shortcut/stories\`, \`cat /shortcut/stories/_index.json\`, and \`cat /shortcut/stories/by-title/roadmap-q3__35.json\`.

Writable discovery contracts:

- discovery/shortcut/<resource>/.schema.json and .create.example.json for each writable collection

Terminal lifecycle fields such as archived, completed, completed_at, epic_state_id, and workflow_state_id remain on canonical records. Only an explicit Shortcut delete action removes a record.
`;

export function layoutPromptFile() {
  return {
    path: `${SHORTCUT_PATH_ROOT}/LAYOUT.md`,
    contentType: "text/markdown; charset=utf-8" as const,
    content: SHORTCUT_LAYOUT_PROMPT.endsWith("\n") ? SHORTCUT_LAYOUT_PROMPT : `${SHORTCUT_LAYOUT_PROMPT}\n`,
  };
}
