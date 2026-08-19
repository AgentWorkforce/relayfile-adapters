import {
  draftFile,
  encodeSegment,
  listJsonFiles,
  readJsonFile,
  type WritebackResult
} from '@relayfile/adapter-core/vfs-client';
import {
  WRITEBACK_PATH_CATALOG,
  writebackPath,
  type WritebackProvider,
  type WritebackResource
} from '@relayfile/adapter-core/writeback-paths';
import {
  createRelayTransportResolver,
  type RelayClientOptions,
} from './transport.js';
import { executeRelayWrite } from './write-authorizer.js';

export type RelayParams = Record<string, string | number>;

/**
 * A catalog-backed client for one provider. Every path comes from
 * `@relayfile/adapter-core/writeback-paths` (the adapter-owned source of
 * truth), so handlers never hardcode `/linear/issues/...` strings that drift
 * from the adapter. Works for any provider in the catalog; the
 * `linearClient` / `githubClient` / `slackClient` factories wrap this with
 * named, ergonomic methods.
 */
export interface RelayClient<P extends WritebackProvider> {
  readonly provider: P;
  /** Resolve a resource's canonical mount path (no IO). */
  path(resource: WritebackResource<P> & string, params?: RelayParams): string;
  /**
   * Write `body`. For a collection resource (e.g. `/linear/issues/{id}/comments`)
   * this drops a uniquely-named draft the Relayfile writeback worker turns into
   * the create call. For an item resource (a path ending in `.json`, e.g.
   * `…/pulls/{n}/merge.json`) this writes the body to that exact path.
   */
  write(resource: WritebackResource<P> & string, params: RelayParams, body: unknown): Promise<WritebackResult>;
  /** Read a single item resource (a `.json` path). */
  read<T>(resource: WritebackResource<P> & string, params?: RelayParams): Promise<T>;
  /** List the records of a collection resource. */
  list<T>(resource: WritebackResource<P> & string, params?: RelayParams): Promise<T[]>;
}

function isItemPath(path: string): boolean {
  return path.endsWith('.json');
}

/**
 * Build a {@link RelayClient} for `provider`. `opts` (mount root, writeback
 * timeout, …) is bound once and reused by every method; it defaults to the
 * ambient sandbox mount-root env, so `relayClient('linear')` is enough inside
 * a sandbox handler.
 */
export function relayClient<P extends WritebackProvider>(
  provider: P,
  opts: RelayClientOptions = {}
): RelayClient<P> {
  const resolveTransport = createRelayTransportResolver(opts);
  const knownResources = (): string => Object.keys(WRITEBACK_PATH_CATALOG[provider] ?? {}).join(', ');
  return {
    provider,
    path(resource, params = {}) {
      return writebackPath(provider, resource, params);
    },
    async write(resource, params, body) {
      const base = writebackPath(provider, resource, params);
      const transport = resolveTransport();
      const request = {
        provider,
        resource: String(resource),
        parameters: { ...params },
        path: base,
        body,
      };
      const target = isItemPath(base) ? base : `${base}/${draftFile(String(resource))}`;
      return executeRelayWrite(
        transport,
        request,
        {
          options: opts,
          integration: provider,
          operation: `write.${String(resource)}`,
          path: target,
          data: body,
        },
      );
    },
    async read<T>(resource: WritebackResource<P> & string, params: RelayParams = {}): Promise<T> {
      // `async` so a validation/path error rejects the promise rather than
      // throwing synchronously — keeps `read` consistent with `write`/`list`
      // for callers using `.catch()`.
      const path = writebackPath(provider, resource, params);
      if (!isItemPath(path)) {
        throw new Error(
          `read("${String(resource)}") resolves to collection "${path}"; read a specific item path or use list(). Known resources for ${provider}: ${knownResources()}`
        );
      }
      const transport = resolveTransport();
      if (transport) {
        return transport.read<T>({
          provider,
          resource: String(resource),
          parameters: { ...params },
          path,
        });
      }
      return readJsonFile<T>(opts, provider, `read.${String(resource)}`, path);
    },
    async list<T>(resource: WritebackResource<P> & string, params: RelayParams = {}): Promise<T[]> {
      const path = writebackPath(provider, resource, params);
      if (isItemPath(path)) {
        throw new Error(
          `list("${String(resource)}") resolves to item "${path}"; use read() instead. Known resources for ${provider}: ${knownResources()}`
        );
      }
      const transport = resolveTransport();
      if (transport) {
        return transport.list<T>({
          provider,
          resource: String(resource),
          parameters: { ...params },
          path,
        });
      }
      const files = await listJsonFiles<T>(opts, provider, `list.${String(resource)}`, path);
      return files.map((file) => file.value);
    }
  };
}

/** Re-exported so callers can build item-read paths (`${collection}/${id}.json`). */
export { encodeSegment, type RelayClientOptions, type WritebackResult };
