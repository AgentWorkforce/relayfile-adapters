import { POSTHOG_RESOURCE_PATHS } from "./resource-paths.generated.js";

export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const readOnlyResources = [
  {
    name: "projects",
    path: POSTHOG_RESOURCE_PATHS.projects,
    pathPattern: /^\/posthog\/projects\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/projects/.schema.json",
    createExample: "discovery/posthog/projects/.create.example.json",
    sampleIndexPath: "/posthog/projects/_index.json",
  },
  {
    name: "insights",
    path: POSTHOG_RESOURCE_PATHS.insights,
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/insights\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/insights/.schema.json",
    createExample: "discovery/posthog/insights/.create.example.json",
    sampleIndexPath: "/posthog/insights/_index.json",
  },
  {
    name: "dashboards",
    path: POSTHOG_RESOURCE_PATHS.dashboards,
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/dashboards\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/dashboards/.schema.json",
    createExample: "discovery/posthog/dashboards/.create.example.json",
    sampleIndexPath: "/posthog/dashboards/_index.json",
  },
  {
    name: "feature-flags",
    path: POSTHOG_RESOURCE_PATHS["feature-flags"],
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/feature-flags\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/feature-flags/.schema.json",
    createExample: "discovery/posthog/feature-flags/.create.example.json",
    sampleIndexPath: "/posthog/feature-flags/_index.json",
  },
  {
    name: "annotations",
    path: POSTHOG_RESOURCE_PATHS.annotations,
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/annotations\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/annotations/.schema.json",
    createExample: "discovery/posthog/annotations/.create.example.json",
    sampleIndexPath: "/posthog/annotations/_index.json",
  },
  {
    name: "experiments",
    path: POSTHOG_RESOURCE_PATHS.experiments,
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/experiments\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/experiments/.schema.json",
    createExample: "discovery/posthog/experiments/.create.example.json",
    sampleIndexPath: "/posthog/experiments/_index.json",
  },
  {
    name: "surveys",
    path: POSTHOG_RESOURCE_PATHS.surveys,
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/surveys\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/surveys/.schema.json",
    createExample: "discovery/posthog/surveys/.create.example.json",
    sampleIndexPath: "/posthog/surveys/_index.json",
  },
  {
    name: "alert-events",
    path: POSTHOG_RESOURCE_PATHS["alert-events"],
    pathPattern:
      /^\/posthog\/projects\/[^/]+\/alert-events\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/posthog/alert-events/.schema.json",
    createExample: "discovery/posthog/alert-events/.create.example.json",
    sampleIndexPath: "/posthog/alert-events/_index.json",
  },
] as const satisfies readonly AdapterResourceConfig[];
