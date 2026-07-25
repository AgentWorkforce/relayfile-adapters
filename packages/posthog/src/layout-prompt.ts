import { POSTHOG_PATH_ROOT } from "./types.js";

export const POSTHOG_LAYOUT_PROMPT = `# PostHog Mount Layout

Always inspect \`_index.json\` files before constructing a record path. PostHog admin records are project-scoped, so canonical files live under the owning project even when aggregate indexes exist at the provider root.

\`/posthog/LAYOUT.md\` is this guide.
\`/posthog/projects/\` holds project metadata records.
\`/posthog/insights/_index.json\`, \`/posthog/dashboards/_index.json\`, \`/posthog/feature-flags/_index.json\`, \`/posthog/annotations/_index.json\`, \`/posthog/experiments/_index.json\`, and \`/posthog/surveys/_index.json\` are aggregate indexes spanning all synced projects.
\`/posthog/projects/<projectId>/insights/\`, \`dashboards/\`, \`feature-flags/\`, \`annotations/\`, \`experiments/\`, and \`surveys/\` hold canonical JSON records keyed by PostHog ids.
\`/posthog/alert-events/_index.json\` and \`/posthog/projects/<projectId>/alert-events/\` hold normalized alert webhook events when configured.

Discovery contracts:
- \`/posthog/projects/{projectId}.json\` -> \`discovery/posthog/projects/.schema.json\`
- \`/posthog/projects/{projectId}/insights/{insightId}.json\` -> \`discovery/posthog/insights/.schema.json\`
- \`/posthog/projects/{projectId}/dashboards/{dashboardId}.json\` -> \`discovery/posthog/dashboards/.schema.json\`
- \`/posthog/projects/{projectId}/feature-flags/{featureFlagId}.json\` -> \`discovery/posthog/feature-flags/.schema.json\`
- \`/posthog/projects/{projectId}/annotations/{annotationId}.json\` -> \`discovery/posthog/annotations/.schema.json\`
- \`/posthog/projects/{projectId}/experiments/{experimentId}.json\` -> \`discovery/posthog/experiments/.schema.json\`
- \`/posthog/projects/{projectId}/surveys/{surveyId}.json\` -> \`discovery/posthog/surveys/.schema.json\`
- \`/posthog/projects/{projectId}/alert-events/{eventId}.json\` -> \`discovery/posthog/alert-events/.schema.json\`

Every collection exposes an \`_index.json\` and a stable \`by-id/\` alias tree. Project records also expose \`/posthog/projects/by-name/\`. Insights expose \`by-short-id/\` aliases within their project, and feature flags expose \`by-key/\` aliases within their project.
`;

export function layoutPromptFile(): {
  path: string;
  content: string;
  contentType: string;
} {
  return {
    path: `${POSTHOG_PATH_ROOT}/LAYOUT.md`,
    contentType: "text/markdown; charset=utf-8",
    content: POSTHOG_LAYOUT_PROMPT.endsWith("\n")
      ? POSTHOG_LAYOUT_PROMPT
      : `${POSTHOG_LAYOUT_PROMPT}\n`,
  };
}
