import { DAYTONA_PATH_ROOT } from "./types.js";

export function layoutPromptFile(): {
  path: string;
  content: string;
  contentType?: string;
} {
  return {
    path: `${DAYTONA_PATH_ROOT}/LAYOUT.md`,
    content: `# Daytona Mount Layout

Use \`${DAYTONA_PATH_ROOT}/_index.json\` before guessing paths.

Canonical usage records live under \`${DAYTONA_PATH_ROOT}/usage/<organizationId>.json\` with matching aliases at \`${DAYTONA_PATH_ROOT}/usage/by-id/<organizationId>.json\`.

Daytona webhook deliveries materialize sandboxes, snapshots, and volumes at:

- \`${DAYTONA_PATH_ROOT}/sandboxes/<id>.json\`
- \`${DAYTONA_PATH_ROOT}/snapshots/<id>.json\`
- \`${DAYTONA_PATH_ROOT}/volumes/<id>.json\`

Terminal states remain readable as record updates; only actual removals become deletes.
`,
    contentType: "text/markdown; charset=utf-8",
  };
}
