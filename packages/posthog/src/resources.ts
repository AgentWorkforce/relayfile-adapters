export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const resources = [
  {
    name: "projects",
    path: "/posthog/projects/{projectId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/projects/.schema.json",
    createExample: "discovery/posthog/projects/.create.example.json",
    sampleIndexPath: "/posthog/projects/_index.json",
  },
  {
    name: "insights",
    path: "/posthog/projects/{projectId}/insights/{insightId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/insights\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/insights/.schema.json",
    createExample: "discovery/posthog/insights/.create.example.json",
    sampleIndexPath: "/posthog/insights",
  },
  {
    name: "dashboards",
    path: "/posthog/projects/{projectId}/dashboards/{dashboardId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/dashboards\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/dashboards/.schema.json",
    createExample: "discovery/posthog/dashboards/.create.example.json",
    sampleIndexPath: "/posthog/dashboards",
  },
  {
    name: "feature-flags",
    path: "/posthog/projects/{projectId}/feature-flags/{featureFlagId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/feature-flags\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/feature-flags/.schema.json",
    createExample: "discovery/posthog/feature-flags/.create.example.json",
    sampleIndexPath: "/posthog/feature-flags",
  },
  {
    name: "annotations",
    path: "/posthog/projects/{projectId}/annotations/{annotationId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/annotations\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/annotations/.schema.json",
    createExample: "discovery/posthog/annotations/.create.example.json",
    sampleIndexPath: "/posthog/annotations",
  },
  {
    name: "experiments",
    path: "/posthog/projects/{projectId}/experiments/{experimentId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/experiments\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/experiments/.schema.json",
    createExample: "discovery/posthog/experiments/.create.example.json",
    sampleIndexPath: "/posthog/experiments",
  },
  {
    name: "surveys",
    path: "/posthog/projects/{projectId}/surveys/{surveyId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/surveys\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/surveys/.schema.json",
    createExample: "discovery/posthog/surveys/.create.example.json",
    sampleIndexPath: "/posthog/surveys",
  },
  {
    name: "alert-events",
    path: "/posthog/projects/{projectId}/alert-events/{eventId}.json",
    pathPattern: /^\/posthog\/projects\/[^/]+\/alert-events\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/alert-events/.schema.json",
    createExample: "discovery/posthog/alert-events/.create.example.json",
    sampleIndexPath: "/posthog/alert-events",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(
  path: string,
): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json")
    ? path
    : path.replace(/\/$/u, "");
  return resources.find((resource) =>
    resource.pathPattern.test(normalizedPath),
  );
}
