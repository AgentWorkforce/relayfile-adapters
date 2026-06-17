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
    name: "organizations",
    path: "/neon/organizations/{orgId}.json",
    pathPattern: /^\/neon\/organizations\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/organizations/.schema.json",
    createExample: "discovery/neon/organizations/.create.example.json",
    sampleIndexPath: "/neon/organizations/_index.json",
  },
  {
    name: "projects",
    path: "/neon/projects/{projectId}.json",
    pathPattern: /^\/neon\/projects\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/projects/.schema.json",
    createExample: "discovery/neon/projects/.create.example.json",
    sampleIndexPath: "/neon/projects/_index.json",
  },
  {
    name: "branches",
    path: "/neon/branches/{branchId}.json",
    pathPattern: /^\/neon\/branches\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/branches/.schema.json",
    createExample: "discovery/neon/branches/.create.example.json",
    sampleIndexPath: "/neon/branches/_index.json",
  },
  {
    name: "endpoints",
    path: "/neon/endpoints/{endpointId}.json",
    pathPattern: /^\/neon\/endpoints\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/endpoints/.schema.json",
    createExample: "discovery/neon/endpoints/.create.example.json",
    sampleIndexPath: "/neon/endpoints/_index.json",
  },
  {
    name: "operations",
    path: "/neon/operations/{operationId}.json",
    pathPattern: /^\/neon\/operations\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/operations/.schema.json",
    createExample: "discovery/neon/operations/.create.example.json",
    sampleIndexPath: "/neon/operations/_index.json",
  },
  {
    name: "project-consumption",
    path: "/neon/consumption/projects/{recordId}.json",
    pathPattern: /^\/neon\/consumption\/projects\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/project-consumption/.schema.json",
    createExample: "discovery/neon/project-consumption/.create.example.json",
    sampleIndexPath: "/neon/consumption/projects/_index.json",
  },
  {
    name: "branch-consumption",
    path: "/neon/consumption/branches/{recordId}.json",
    pathPattern: /^\/neon\/consumption\/branches\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/branch-consumption/.schema.json",
    createExample: "discovery/neon/branch-consumption/.create.example.json",
    sampleIndexPath: "/neon/consumption/branches/_index.json",
  },
  {
    name: "spending-limits",
    path: "/neon/spending-limits/{orgId}.json",
    pathPattern: /^\/neon\/spending-limits\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/spending-limits/.schema.json",
    createExample: "discovery/neon/spending-limits/.create.example.json",
    sampleIndexPath: "/neon/spending-limits/_index.json",
  },
  {
    name: "advisor-issues",
    path: "/neon/advisors/{issueId}.json",
    pathPattern: /^\/neon\/advisors\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: "discovery/neon/advisor-issues/.schema.json",
    createExample: "discovery/neon/advisor-issues/.create.example.json",
    sampleIndexPath: "/neon/advisors/_index.json",
  },
] as const satisfies readonly AdapterResourceConfig[];
