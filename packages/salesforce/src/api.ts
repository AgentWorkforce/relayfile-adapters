import { withProxyRetry } from '@relayfile/adapter-core/http';
import type { ConnectionProvider, ProxyResponse } from '@relayfile/sdk';

import { normalizeSalesforceObjectType } from './path-mapper.js';
import type { SalesforceAdapterConfig } from './types.js';

export interface SalesforceFetchOptions {
  connectionId?: string;
  providerConfigKey?: string;
}

export class SalesforceApiClient {
  constructor(
    private readonly provider: ConnectionProvider,
    private readonly config: SalesforceAdapterConfig,
  ) {}

  async fetchSObject(
    objectType: string,
    objectId: string,
    options: SalesforceFetchOptions = {},
  ): Promise<Record<string, unknown>> {
    const normalizedType = normalizeSalesforceObjectType(objectType);
    const endpoint = `/services/data/${this.config.apiVersion ?? 'v62.0'}/sobjects/${normalizedType}/${encodeURIComponent(objectId)}`;
    const providerConfigKey = resolveProviderConfigKey(this.provider, this.config, options);
    const response = await withProxyRetry(this.provider).proxy<Record<string, unknown>>({
      method: 'GET',
      baseUrl: this.config.instanceUrl ?? '',
      endpoint,
      connectionId: await resolveConnectionId(this.provider, this.config, options),
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

  throw new Error(`Salesforce SObject fetch for ${endpoint} must return a JSON object.`);
}

async function resolveConnectionId(
  provider: ConnectionProvider,
  config: SalesforceAdapterConfig,
  options: SalesforceFetchOptions,
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

  const resolver = readProviderFunction(provider, 'resolveConnectionId') ?? readProviderFunction(provider, 'getConnectionId');
  const resolved = await resolver?.();
  const resolvedString = firstString(resolved);
  if (resolvedString) {
    return resolvedString;
  }

  throw new Error(
    'SalesforceAdapterConfig.connectionId is required for provider-backed Salesforce API calls',
  );
}

function resolveProviderConfigKey(
  provider: ConnectionProvider,
  config: SalesforceAdapterConfig,
  options: SalesforceFetchOptions,
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
  return typeof value === 'function' ? value.bind(provider) as () => Promise<unknown> | unknown : undefined;
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
