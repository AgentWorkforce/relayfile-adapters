import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseMappingSpecText,
  SchemaAdapter,
  type MappingSpec,
} from '@relayfile/adapter-core';
import type { RelayFileClient } from '@relayfile/sdk';

import type { ConnectionProvider } from '@relayfile/sdk';
import type { GitHubAdapterConfig } from './types.js';

const NOOP_CLIENT = {
  async ingestWebhook() {
    return { status: 'queued', id: 'schema-adapter-stub' };
  },
} as unknown as RelayFileClient;

let _mappingPath: string | undefined;
let _mappingSpec: MappingSpec | undefined;

/**
 * Resolve the absolute filesystem path of `github.mapping.yaml`.
 *
 * Computed lazily on first call. Previously this was a top-level
 * `const` initialized at module load via
 * `fileURLToPath(new URL(..., import.meta.url))`, which made the
 * module impossible to bundle into a Cloudflare Worker: esbuild
 * rewrites `import.meta.url` to a synthetic `placeholder:…` string
 * during bundling, and `new URL(relative, 'placeholder:…')` throws
 * `TypeError: Invalid URL string` when CF runs the worker's
 * top-level code as part of deploy validation (error 10021).
 *
 * Deferring to first call lets the package be safely imported from
 * Workers code that never actually invokes the schema adapter
 * (e.g. consumers that only need `searchIssues` / `searchRepos`
 * from `./operations`, but still import them via the barrel because
 * the package doesn't expose a `./operations` subpath).
 *
 * Throws on platforms without `import.meta.url` filesystem mapping
 * (Cloudflare Workers, browsers). Don't call this from
 * Worker-bundled code paths.
 */
export function githubMappingPath(): string {
  return (_mappingPath ??= fileURLToPath(new URL('../github.mapping.yaml', import.meta.url)));
}

/**
 * Lazily parse and memoize the GitHub mapping spec.
 *
 * Same lazy semantics as {@link githubMappingPath} — reads
 * `github.mapping.yaml` from disk on first call. Requires a
 * Node-style filesystem; not callable from Cloudflare Workers.
 */
export function githubMappingSpec(): MappingSpec {
  if (_mappingSpec === undefined) {
    const path = githubMappingPath();
    _mappingSpec = parseMappingSpecText(readFileSync(path, 'utf8'), path);
  }
  return _mappingSpec;
}

export function createGitHubSchemaAdapter(
  provider: ConnectionProvider,
  config: Pick<GitHubAdapterConfig, 'connectionId'> = {},
): SchemaAdapter {
  return new SchemaAdapter({
    client: NOOP_CLIENT,
    provider: provider as never,
    spec: githubMappingSpec(),
    defaultConnectionId: config.connectionId,
  });
}
