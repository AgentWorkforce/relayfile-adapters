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

function resolveGitHubMappingPath(): string {
  return (_mappingPath ??= fileURLToPath(new URL('../github.mapping.yaml', import.meta.url)));
}

function resolveGitHubMappingSpec(): MappingSpec {
  if (_mappingSpec === undefined) {
    const path = resolveGitHubMappingPath();
    _mappingSpec = parseMappingSpecText(readFileSync(path, 'utf8'), path);
  }
  return _mappingSpec;
}

/**
 * Resolve the absolute filesystem path of `github.mapping.yaml`.
 *
 * Exposed as a lazy value so existing consumers can keep treating it
 * as a string while Cloudflare Worker bundles avoid top-level fs/url
 * side effects until the property is actually accessed.
 */
export const githubMappingPath = {
  toString(): string {
    return resolveGitHubMappingPath();
  },
  valueOf(): string {
    return resolveGitHubMappingPath();
  },
  [Symbol.toPrimitive](): string {
    return resolveGitHubMappingPath();
  },
  endsWith(searchString: string, endPosition?: number): boolean {
    return resolveGitHubMappingPath().endsWith(searchString, endPosition);
  },
} as Pick<string, 'endsWith'> & { toString(): string; valueOf(): string; [Symbol.toPrimitive](): string };

/**
 * Lazily parse and memoize the GitHub mapping spec while preserving the
 * existing value export shape for consumers that treat it like a spec object.
 */
export const githubMappingSpec = new Proxy({} as MappingSpec, {
  get(_target, prop, receiver) {
    return Reflect.get(resolveGitHubMappingSpec() as object, prop, receiver);
  },
  has(_target, prop) {
    return prop in (resolveGitHubMappingSpec() as object);
  },
  ownKeys() {
    return Reflect.ownKeys(resolveGitHubMappingSpec() as object);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const descriptor = Object.getOwnPropertyDescriptor(resolveGitHubMappingSpec() as object, prop);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

export function createGitHubSchemaAdapter(
  provider: ConnectionProvider,
  config: Pick<GitHubAdapterConfig, 'connectionId'> = {},
): SchemaAdapter {
  return new SchemaAdapter({
    client: NOOP_CLIENT,
    provider: provider as never,
    spec: resolveGitHubMappingSpec(),
    defaultConnectionId: config.connectionId,
  });
}
