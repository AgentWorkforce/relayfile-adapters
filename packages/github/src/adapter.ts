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

const MAPPING_PATH = fileURLToPath(new URL('../github.mapping.yaml', import.meta.url));
const NOOP_CLIENT = {
  async ingestWebhook() {
    return { status: 'queued', id: 'schema-adapter-stub' };
  },
} as unknown as RelayFileClient;

export const githubMappingPath = MAPPING_PATH;
export const githubMappingSpec: MappingSpec = parseMappingSpecText(
  readFileSync(MAPPING_PATH, 'utf8'),
  MAPPING_PATH,
);

export function createGitHubSchemaAdapter(
  provider: ConnectionProvider,
  config: Pick<GitHubAdapterConfig, 'connectionId'> = {},
): SchemaAdapter {
  return new SchemaAdapter({
    client: NOOP_CLIENT,
    provider: provider as never,
    spec: githubMappingSpec,
    defaultConnectionId: config.connectionId,
  });
}
