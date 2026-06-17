export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
}

export const resources = [
  {
    name: "pages",
    path: "/notion/databases/{databaseId}/pages",
    pathPattern: /^\/notion\/databases\/[^\/]+\/pages(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/databases/{databaseId}/pages/.schema.json",
    createExample: "discovery/notion/databases/{databaseId}/pages/.create.example.json",
  },
  {
    name: "pages",
    path: "/notion/databases/{databaseId}/pages/{pageId}/meta.json",
    pathPattern: /^\/notion\/databases\/[^\/]+\/pages\/[^\/]+\/meta\.json$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/databases/{databaseId}/pages/{pageId}/meta.json/.schema.json",
    createExample: "discovery/notion/databases/{databaseId}/pages/{pageId}/meta.json/.create.example.json",
  },
  {
    name: "properties",
    path: "/notion/databases/{databaseId}/pages/{pageId}/properties.json",
    pathPattern: /^\/notion\/databases\/[^\/]+\/pages\/[^\/]+\/properties\.json$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/databases/{databaseId}/pages/{pageId}/properties.json/.schema.json",
    createExample: "discovery/notion/databases/{databaseId}/pages/{pageId}/properties.json/.create.example.json",
  },
  {
    name: "content",
    path: "/notion/databases/{databaseId}/pages/{pageId}/content.md",
    pathPattern: /^\/notion\/databases\/[^\/]+\/pages\/[^\/]+\/content\.md$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/databases/{databaseId}/pages/{pageId}/content.md/.schema.json",
    createExample: "discovery/notion/databases/{databaseId}/pages/{pageId}/content.md/.create.example.json",
  },
  {
    name: "comments",
    path: "/notion/databases/{databaseId}/pages/{pageId}/comments.json",
    pathPattern: /^\/notion\/databases\/[^\/]+\/pages\/[^\/]+\/comments\.json$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/databases/{databaseId}/pages/{pageId}/comments.json/.schema.json",
    createExample: "discovery/notion/databases/{databaseId}/pages/{pageId}/comments.json/.create.example.json",
  },
  {
    name: "pages",
    path: "/notion/pages/{pageId}/meta.json",
    pathPattern: /^\/notion\/pages\/[^\/]+\/meta\.json$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/pages/{pageId}/meta.json/.schema.json",
    createExample: "discovery/notion/pages/{pageId}/meta.json/.create.example.json",
  },
  {
    name: "properties",
    path: "/notion/pages/{pageId}/properties.json",
    pathPattern: /^\/notion\/pages\/[^\/]+\/properties\.json$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/pages/{pageId}/properties.json/.schema.json",
    createExample: "discovery/notion/pages/{pageId}/properties.json/.create.example.json",
  },
  {
    name: "content",
    path: "/notion/pages/{pageId}/content.md",
    pathPattern: /^\/notion\/pages\/[^\/]+\/content\.md$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/pages/{pageId}/content.md/.schema.json",
    createExample: "discovery/notion/pages/{pageId}/content.md/.create.example.json",
  },
  {
    name: "comments",
    path: "/notion/pages/{pageId}/comments.json",
    pathPattern: /^\/notion\/pages\/[^\/]+\/comments\.json$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    schema: "discovery/notion/pages/{pageId}/comments.json/.schema.json",
    createExample: "discovery/notion/pages/{pageId}/comments.json/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
