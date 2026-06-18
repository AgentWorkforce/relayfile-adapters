import {
  readOnlyResources,
  type AdapterResourceConfig,
} from "./read-only-resources.js";

export type { AdapterResourceConfig } from "./read-only-resources.js";
export { readOnlyResources } from "./read-only-resources.js";

// Cloudflare is read-only for writeback, but Cloud still needs the resource
// catalog populated so discovery schemas and layout contracts stay aligned.
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
