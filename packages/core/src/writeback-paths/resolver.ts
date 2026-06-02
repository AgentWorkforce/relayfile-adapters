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
  const catalog = WRITEBACK_PATH_CATALOG as Record<
    string,
    Record<string, readonly { path: string; params: readonly string[] }[]>
  >;
  // `Object.hasOwn` (not `catalog[provider]`) so prototype keys like
  // "constructor"/"toString" resolve to the loud error, not a stray function
  // off Object.prototype.
  if (!Object.hasOwn(catalog, provider)) {
    throw new WritebackPathError(
      `Unknown writeback provider "${provider}". Known providers: ${Object.keys(catalog).join(", ")}`
    );
  }
  const providerEntry = catalog[provider];
  if (!Object.hasOwn(providerEntry, resource)) {
    throw new WritebackPathError(
      `Unknown writeback resource "${resource}" for provider "${provider}". Known resources: ${Object.keys(providerEntry).join(", ")}`
    );
  }
  const variant = selectVariant(provider, resource, providerEntry[resource], params);
  return variant.path.replace(/\{([^}]+)\}/gu, (_match, name: string) => {
    // `Object.hasOwn`, not `params[name]`: a template param named like
    // "toString"/"constructor" would otherwise resolve to an Object.prototype
    // member and bypass the missing-param check, baking garbage into the path.
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined || value === null || value === "") {
      throw new WritebackPathError(
        `Missing path parameter "${name}" for ${provider}/${resource} (template "${variant.path}")`
      );
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * A resource name can map to several path templates (the same entity mounted at
 * different roots). With a single template there's nothing to choose. With
 * several, the supplied param keys must exactly match one template's params —
 * `{databaseId}` vs `{databaseId, pageId}` vs `{pageId}` are distinct — so the
 * choice is deterministic. Anything else throws rather than guessing.
 */
function selectVariant(
  provider: string,
  resource: string,
  variants: readonly { path: string; params: readonly string[] }[],
  params: WritebackPathParams
): { path: string; params: readonly string[] } {
  if (variants.length === 1) {
    return variants[0];
  }
  const providedKeys = new Set(Object.keys(params));
  const matches = variants.filter(
    (variant) =>
      variant.params.length === providedKeys.size && variant.params.every((name) => providedKeys.has(name))
  );
  if (matches.length === 1) {
    return matches[0];
  }
  const templates = variants.map((variant) => `"${variant.path}" (params: ${variant.params.join(", ") || "none"})`).join("; ");
  throw new WritebackPathError(
    `Ambiguous writeback resource "${resource}" for provider "${provider}": ` +
      `params {${[...providedKeys].join(", ") || "none"}} ${matches.length === 0 ? "match no" : "match multiple"} of its ${variants.length} templates. Candidates: ${templates}`
  );
}
