import {
  readOnlyResources,
  type AdapterResourceConfig,
} from "./read-only-resources.js";

export type { AdapterResourceConfig } from "./read-only-resources.js";
export { readOnlyResources } from "./read-only-resources.js";

export const resources = readOnlyResources;

export function findResourceByPath(
  path: string,
): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json")
    ? path
    : path.replace(/\/$/u, "");
  return readOnlyResources.find((resource) =>
    resource.pathPattern.test(normalizedPath),
  );
}
