import { withProxyRetry } from '@relayfile/adapter-core/http';
import type { ConnectionProvider, ProxyResponse } from '@relayfile/sdk';

import { normalizeHubSpotObjectType } from './path-mapper.js';
import type { HubSpotAdapterConfig } from './types.js';

export interface HubSpotFetchOptions {
  connectionId?: string;
  providerConfigKey?: string;
  /** Comma-separated list of property names to include in the response. */
  properties?: string;
}

const CRM_API_VERSION = 'v3';

/**
 * Minimal API client for re-fetching full HubSpot CRM object records.
 * HubSpot webhooks are notification-only (carrying only objectId, subscriptionType,
 * and a single changed property). Before writing, the adapter uses this client to
 * fetch the complete record from the CRM API so consumers get authoritative data.
 */
export class HubSpotApiClient {
  constructor(
    private readonly provider: ConnectionProvider,
    private readonly config: HubSpotAdapterConfig,
  ) {}

  /**
   * Fetches a full CRM object record from the HubSpot CRM API.
   * @param objectType - CRM object type: contact, company, deal, or ticket.
   * @param objectId   - Provider-stable numeric or string object ID.
   */
  async fetchCrmObject(
    objectType: string,
    objectId: string,
    options: HubSpotFetchOptions = {},
  ): Promise<Record<string, unknown>> {
    const normalizedType = normalizeHubSpotObjectType(objectType);
    // Map canonical singular types to plural API path segments
    const apiSegment = pluralObjectType(normalizedType);
    const endpoint = `/crm/${CRM_API_VERSION}/objects/${apiSegment}/${encodeURIComponent(objectId)}`;

    const connectionId = await resolveConnectionId(this.provider, this.config, options);
    const providerConfigKey = resolveProviderConfigKey(this.provider, this.config, options);

    const baseUrl = this.config.apiBaseUrl ?? '';

    const response = await withProxyRetry(this.provider).proxy<Record<string, unknown>>({
      method: 'GET',
      baseUrl,
      endpoint,
      connectionId,
      ...(providerConfigKey ? { headers: { 'Provider-Config-Key': providerConfigKey } } : {}),
      ...(options.properties
        ? { query: { properties: options.properties } }
        : {}),
    });

    ensureOk('GET', endpoint, response);
    return expectRecord(response.data, endpoint);
  }
}

function pluralObjectType(objectType: string): string {
  // HubSpot CRM API uses plural path segments: /contacts, /companies, /deals, /tickets
  switch (objectType) {
    case 'contact':
      return 'contacts';
    case 'company':
      return 'companies';
    case 'deal':
      return 'deals';
    case 'ticket':
      return 'tickets';
    default:
      return `${objectType}s`;
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

  throw new Error(`HubSpot CRM object fetch for ${endpoint} must return a JSON object.`);
}

async function resolveConnectionId(
  provider: ConnectionProvider,
  config: HubSpotAdapterConfig,
  options: HubSpotFetchOptions,
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
    'HubSpotAdapterConfig.connectionId is required for provider-backed HubSpot API calls',
  );
}

function resolveProviderConfigKey(
  provider: ConnectionProvider,
  config: HubSpotAdapterConfig,
  options: HubSpotFetchOptions,
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
