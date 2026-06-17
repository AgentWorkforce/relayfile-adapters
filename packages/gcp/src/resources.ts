import {
  readOnlyResources,
  type AdapterResourceConfig,
} from "./read-only-resources.js";

export type { AdapterResourceConfig } from "./read-only-resources.js";
export { readOnlyResources } from "./read-only-resources.js";

// GCP is read-only for Relayfile: sync/webhook materialization, auxiliary
// aliases, and digests are supported, but no file-native writeback contract is
// exposed. The writeback catalog generator treats an exported `resources` array
// as writeback path templates, so keep that export intentionally empty.
export const resources = [] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/u, "");
  return readOnlyResources.find((resource) => resource.pathPattern.test(normalizedPath));
}
