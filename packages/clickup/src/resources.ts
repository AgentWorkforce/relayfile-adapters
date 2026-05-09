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
    name: "comments",
    path: "/clickup/tasks/{taskId}/comments",
    pathPattern: /^\/clickup\/tasks\/[^\/]+\/comments(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$/,
    schema: "discovery/clickup/tasks/{taskId}/comments/.schema.json",
    createExample: "discovery/clickup/tasks/{taskId}/comments/.create.example.json",
  },
  {
    name: "tasks",
    path: "/clickup/lists/{listId}/tasks",
    pathPattern: /^\/clickup\/lists\/[^\/]+\/tasks(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$/,
    schema: "discovery/clickup/lists/{listId}/tasks/.schema.json",
    createExample: "discovery/clickup/lists/{listId}/tasks/.create.example.json",
  },
  {
    name: "lists",
    path: "/clickup/folders/{folderId}/lists",
    pathPattern: /^\/clickup\/folders\/[^\/]+\/lists(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$/,
    schema: "discovery/clickup/folders/{folderId}/lists/.schema.json",
    createExample: "discovery/clickup/folders/{folderId}/lists/.create.example.json",
  },
  {
    name: "lists",
    path: "/clickup/spaces/{spaceId}/lists",
    pathPattern: /^\/clickup\/spaces\/[^\/]+\/lists(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$/,
    schema: "discovery/clickup/spaces/{spaceId}/lists/.schema.json",
    createExample: "discovery/clickup/spaces/{spaceId}/lists/.create.example.json",
  },
  {
    name: "folders",
    path: "/clickup/spaces/{spaceId}/folders",
    pathPattern: /^\/clickup\/spaces\/[^\/]+\/folders(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$/,
    schema: "discovery/clickup/spaces/{spaceId}/folders/.schema.json",
    createExample: "discovery/clickup/spaces/{spaceId}/folders/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
