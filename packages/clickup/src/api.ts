import { withProxyRetry } from '@relayfile/adapter-core/http';
import type { ConnectionProvider, ProxyResponse } from '@relayfile/sdk';

import type { ClickUpAdapterConfig } from './types.js';

export interface ClickUpFetchOptions {
  connectionId?: string;
  providerConfigKey?: string;
  /**
   * If true, include subtask data in the response.
   * Defaults to false to keep the response lightweight.
   */
  includeSubtasks?: boolean;
}

const CLICKUP_API_BASE = 'https://api.clickup.com';
const CLICKUP_API_PATH_PREFIX = '/api/v2';

/**
 * Minimal API client for re-fetching full ClickUp task records.
 * ClickUp webhooks carry only {event, task_id, history_items} with almost no
 * record data. Before writing, the adapter uses this client to fetch the
 * complete task from the ClickUp REST API so consumers get authoritative data.
 */
export class ClickUpApiClient {
  constructor(
    private readonly provider: ConnectionProvider,
    private readonly config: ClickUpAdapterConfig,
  ) {}

  /**
   * Fetches a full task record from the ClickUp API.
   * @param taskId - The ClickUp task ID (e.g. "abc123xyz").
   */
  async fetchTask(
    taskId: string,
    options: ClickUpFetchOptions = {},
  ): Promise<Record<string, unknown>> {
    const endpoint = `${CLICKUP_API_PATH_PREFIX}/task/${encodeURIComponent(taskId)}`;
    const connectionId = await resolveConnectionId(this.provider, this.config, options);
    const providerConfigKey = resolveProviderConfigKey(this.provider, this.config, options);

    const baseUrl = this.config.apiUrl ?? CLICKUP_API_BASE;

    const response = await withProxyRetry(this.provider).proxy<Record<string, unknown>>({
      method: 'GET',
      baseUrl,
      endpoint,
      connectionId,
      ...(providerConfigKey ? { headers: { 'Provider-Config-Key': providerConfigKey } } : {}),
    });

    ensureOk('GET', endpoint, response);
    return expectRecord(response.data, endpoint);
  }
}

function ensureOk(method: string, endpoint: string, response: ProxyResponse): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const detail =
    typeof response.data === 'string'
      ? response.data
      : response.data && typeof response.data === 'object'
        ? JSON.stringify(response.data)
        : 'Unknown provider error';

  throw new Error(`${method} ${endpoint} failed with ${response.status}: ${detail}`);
}

function expectRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new Error(`ClickUp task fetch for ${endpoint} must return a JSON object.`);
}

async function resolveConnectionId(
  provider: ConnectionProvider,
  config: ClickUpAdapterConfig,
  options: ClickUpFetchOptions,
): Promise<string> {
  const direct = firstString(
    options.connectionId,
    config.connectionId,
    readProviderString(provider, 'connectionId'),
    readProviderString(provider, 'defaultConnectionId'),
  );
  if (direct) {
    return direct;
  }

  const resolver =
    readProviderFunction(provider, 'resolveConnectionId') ??
    readProviderFunction(provider, 'getConnectionId');
  const resolved = await resolver?.();
  const resolvedString = firstString(resolved);
  if (resolvedString) {
    return resolvedString;
  }

  throw new Error(
    'ClickUpAdapterConfig.connectionId is required for provider-backed ClickUp API calls',
  );
}

function resolveProviderConfigKey(
  provider: ConnectionProvider,
  config: ClickUpAdapterConfig,
  options: ClickUpFetchOptions,
): string | undefined {
  return firstString(
    options.providerConfigKey,
    config.providerConfigKey,
    readProviderString(provider, 'providerConfigKey'),
    readProviderString(provider, 'defaultProviderConfigKey'),
  );
}

function readProviderString(provider: ConnectionProvider, key: string): string | undefined {
  return firstString((provider as unknown as Record<string, unknown>)[key]);
}

function readProviderFunction(
  provider: ConnectionProvider,
  key: string,
): (() => Promise<unknown> | unknown) | undefined {
  const value = (provider as unknown as Record<string, unknown>)[key];
  return typeof value === 'function'
    ? (value.bind(provider) as () => Promise<unknown> | unknown)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
