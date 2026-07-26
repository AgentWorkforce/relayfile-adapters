import { POSTHOG_PATH_ROOT } from "./types.js";

export const POSTHOG_LAYOUT_PROMPT = `# PostHog Mount Layout

Always inspect \`_index.json\` files before constructing a record path. PostHog admin records are project-scoped, so canonical files live under the owning project even when aggregate indexes exist at the provider root.

\`/posthog/LAYOUT.md\` is this guide.
\`/posthog/projects/\` holds project metadata records.
\`/posthog/insights/_index.json\`, \`/posthog/dashboards/_index.json\`, \`/posthog/feature-flags/_index.json\`, \`/posthog/annotations/_index.json\`, \`/posthog/experiments/_index.json\`, and \`/posthog/surveys/_index.json\` are aggregate indexes spanning all synced projects.
\`/posthog/projects/<projectId>/insights/\`, \`dashboards/\`, \`feature-flags/\`, \`annotations/\`, \`experiments/\`, and \`surveys/\` hold canonical flat records named \`<slug>__<id>.json\`. The stable PostHog id after the double underscore remains authoritative when a title changes.
\`/posthog/alert-events/_index.json\` and \`/posthog/projects/<projectId>/alert-events/\` hold normalized alert webhook events when configured.

Discovery contracts:
- \`/posthog/projects/{projectId}.json\` -> \`discovery/posthog/projects/.schema.json\`
- \`/posthog/projects/{projectId}/insights/{slug}__{insightId}.json\` -> \`discovery/posthog/insights/.schema.json\`
- \`/posthog/projects/{projectId}/dashboards/{slug}__{dashboardId}.json\` -> \`discovery/posthog/dashboards/.schema.json\`
- \`/posthog/projects/{projectId}/feature-flags/{slug}__{featureFlagId}.json\` -> \`discovery/posthog/feature-flags/.schema.json\`
- \`/posthog/projects/{projectId}/annotations/{slug}__{annotationId}.json\` -> \`discovery/posthog/annotations/.schema.json\`
- \`/posthog/projects/{projectId}/experiments/{slug}__{experimentId}.json\` -> \`discovery/posthog/experiments/.schema.json\`
- \`/posthog/projects/{projectId}/surveys/{slug}__{surveyId}.json\` -> \`discovery/posthog/surveys/.schema.json\`
- \`/posthog/projects/{projectId}/alert-events/{slug}__{eventId}.json\` -> \`discovery/posthog/alert-events/.schema.json\`

Every collection exposes an \`_index.json\` and a stable \`by-id/\` alias tree. Alias files are pointer envelopes with \`canonicalPath\`; follow that field to read the canonical record. Project records expose \`/posthog/projects/by-name/\`. Insights expose \`by-short-id/\`, feature flags expose \`by-key/\`, and dashboards, experiments, and surveys expose deterministic \`by-name/\` aliases within their project.

Useful reads:
- \`jq 'map({id, title, updated, canonicalPath})' /posthog/insights/_index.json\`
- \`jq 'map(select(.status == "running"))' /posthog/experiments/_index.json\`
- \`jq -r '.canonicalPath' /posthog/projects/<projectId>/dashboards/by-name/<name-hash>__<id>.json\`
- \`ls /posthog/projects/<projectId>/feature-flags/by-key/\`

Lifecycle states such as resolved alerts, archived flags, completed experiments, and closed surveys remain readable canonical records. A terminal state is not a deletion; only an explicit upstream deletion removes a canonical file and its aliases.
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
