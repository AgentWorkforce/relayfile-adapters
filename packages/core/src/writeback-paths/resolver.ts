import { WRITEBACK_PATH_CATALOG, type WritebackProvider, type WritebackResource } from "./catalog.generated.js";

/**
 * Thrown when a writeback path cannot be resolved — an unknown provider or
 * resource, or a path-template parameter that was not supplied. This always
 * throws loudly rather than falling back to a partial/guessed path: a draft
 * written to the wrong path silently never becomes a provider call, which is
 * far harder to debug than an upfront error.
 */
export class WritebackPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WritebackPathError";
  }
}

export type WritebackPathParams = Record<string, string | number>;

/**
 * Resolve the canonical Relayfile-mount directory path for a provider
 * writeback resource, substituting `{param}` placeholders. Callers append a
 * draft filename (e.g. `create comment <uuid>.json`) to the returned path.
 *
 * @example
 *   writebackPath("linear", "comments", { issueId: "ISS-1" })
 *   // → "/linear/issues/ISS-1/comments"
 */
export function writebackPath<P extends WritebackProvider>(
  provider: P,
  resource: WritebackResource<P> & string,
  params?: WritebackPathParams
): string;
export function writebackPath(provider: string, resource: string, params?: WritebackPathParams): string;
export function writebackPath(provider: string, resource: string, params: WritebackPathParams = {}): string {
  const providerEntry = (WRITEBACK_PATH_CATALOG as Record<string, Record<string, { path: string; params: readonly string[] }>>)[provider];
  if (!providerEntry) {
    throw new WritebackPathError(
      `Unknown writeback provider "${provider}". Known providers: ${Object.keys(WRITEBACK_PATH_CATALOG).join(", ")}`
    );
  }
  const resourceEntry = providerEntry[resource];
  if (!resourceEntry) {
    throw new WritebackPathError(
      `Unknown writeback resource "${resource}" for provider "${provider}". Known resources: ${Object.keys(providerEntry).join(", ")}`
    );
  }
  return resourceEntry.path.replace(/\{([^}]+)\}/gu, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === "") {
      throw new WritebackPathError(
        `Missing path parameter "${name}" for ${provider}/${resource} (template "${resourceEntry.path}")`
      );
    }
    return encodeURIComponent(String(value));
  });
}
