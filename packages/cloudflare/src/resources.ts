import {
  readOnlyResources,
  type AdapterResourceConfig,
} from "./read-only-resources.js";

export type { AdapterResourceConfig } from "./read-only-resources.js";
export { readOnlyResources } from "./read-only-resources.js";

// Cloudflare is currently read-only for Relayfile materialization. Keep the
// writeback catalog empty so adapter-core does not advertise unsupported file
// native writes for inventory and notification records.
export const resources = [] as const satisfies readonly AdapterResourceConfig[];

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
