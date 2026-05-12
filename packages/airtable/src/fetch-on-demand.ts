import { createHash } from 'node:crypto';

import type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  airtableNotificationPath,
  parseAirtableNotificationPath,
} from './path-mapper.js';
import type {
  AirtableFetchOnDemandOptions,
  AirtableMaterializedChangePayload,
  AirtableWebhookNotification,
  AirtableWebhookPayloadPage,
} from './types.js';

export const AIRTABLE_WEBHOOK_PAYLOADS_ROUTE_TEMPLATE = '/v0/bases/{baseId}/webhooks/{webhookId}/payloads';

export function createAirtableFetchOnDemand(
  provider: ConnectionProvider,
  options: AirtableFetchOnDemandOptions = {},
): (notification: AirtableWebhookNotification | string) => Promise<AirtableMaterializedChangePayload> {
  return async (notification) => fetchOnDemand(notification, provider, options);
}

export async function fetchOnDemand(
  notification: AirtableWebhookNotification | string,
  provider: ConnectionProvider,
  options: AirtableFetchOnDemandOptions = {},
): Promise<AirtableMaterializedChangePayload> {
  const resolved = resolveNotification(notification, options);
  const endpoint = AIRTABLE_WEBHOOK_PAYLOADS_ROUTE_TEMPLATE
    .replace('{baseId}', encodeURIComponent(resolved.baseId))
    .replace('{webhookId}', encodeURIComponent(resolved.webhookId));
  const payloads: Record<string, unknown>[] = [];
  let lastData: Record<string, unknown> | undefined;
  let lastPage: AirtableWebhookPayloadPage | undefined;
  let cursor = resolved.cursor;

  while (true) {
    const query = {
      ...(options.query ?? {}),
      ...(cursor !== undefined ? { cursor: String(cursor) } : {}),
    };
    const request: ProxyRequest = {
      method: 'GET',
      baseUrl: options.apiUrl ?? '',
      connectionId: resolved.connectionId,
      endpoint,
    };
    if (resolved.providerConfigKey) {
      request.headers = { 'Provider-Config-Key': resolved.providerConfigKey };
    }
    if (Object.keys(query).length > 0) {
      request.query = query;
    }

    const response = await provider.proxy<Record<string, unknown>>(request);
    assertOk(response, endpoint);
    const data = expectRecord(response.data, endpoint);
    const page = normalizePayloadPage(data);
    payloads.push(...page.payloads);
    lastData = data;
    lastPage = page;

    if (!page.mightHaveMore || page.cursor === undefined || page.cursor === cursor) {
      break;
    }

    cursor = page.cursor;
  }

  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        baseId: resolved.baseId,
        webhookId: resolved.webhookId,
        payloads,
      }),
    )
    .digest('hex');

  return {
    baseId: resolved.baseId,
    digest,
    webhookId: resolved.webhookId,
    notificationId: resolved.notificationId,
    endpoint,
    path: resolved.path,
    data: lastData ?? {},
    ...(lastPage?.cursor !== undefined ? { cursor: lastPage.cursor } : {}),
    ...(lastPage?.mightHaveMore !== undefined ? { mightHaveMore: lastPage.mightHaveMore } : {}),
    ...(lastPage?.payloadFormat ? { payloadFormat: lastPage.payloadFormat } : {}),
    payloads,
  };
}

function assertOk(response: ProxyResponse, endpoint: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const detail =
    typeof response.data === 'string'
      ? response.data
      : response.data && typeof response.data === 'object'
        ? JSON.stringify(response.data)
        : 'Unknown provider error';
  throw new Error(`GET ${endpoint} failed with ${response.status}: ${detail}`);
}

function expectRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Airtable payload materialization for ${endpoint} must return a JSON object.`);
}

function normalizePayloadPage(data: Record<string, unknown>): AirtableWebhookPayloadPage {
  const cursor = readOptionalNumber(data.cursor);
  const payloadFormat = readOptionalString(data.payloadFormat);
  return {
    ...(cursor !== undefined ? { cursor } : {}),
    ...(typeof data.mightHaveMore === 'boolean' ? { mightHaveMore: data.mightHaveMore } : {}),
    ...(payloadFormat ? { payloadFormat } : {}),
    payloads: Array.isArray(data.payloads)
      ? data.payloads.filter(isRecord)
      : [],
  };
}

function resolveNotification(
  notification: AirtableWebhookNotification | string,
  options: AirtableFetchOnDemandOptions,
): {
  baseId: string;
  webhookId: string;
  notificationId: string;
  connectionId: string;
  cursor?: number;
  path: string;
  providerConfigKey?: string;
} {
  if (typeof notification !== 'string') {
    const baseId = requireString(notification.baseId, 'Airtable notification baseId');
    const webhookId = requireString(notification.webhookId, 'Airtable notification webhookId');
    const connectionId = requireString(
      notification.connectionId ?? options.connectionId,
      'Airtable fetchOnDemand connectionId',
    );
    const cursor = notification.cursor ?? options.cursor;
    const providerConfigKey = notification.providerConfigKey ?? options.providerConfigKey;
    return {
      baseId,
      webhookId,
      notificationId: notification.notificationId?.trim() || webhookId,
      connectionId,
      ...(cursor !== undefined ? { cursor } : {}),
      path: notification.path ?? airtableNotificationPath(baseId, webhookId),
      ...(providerConfigKey ? { providerConfigKey } : {}),
    };
  }

  if (notification.startsWith('/airtable/')) {
    const parsed = parseAirtableNotificationPath(notification);
    const connectionId = requireString(options.connectionId, 'Airtable fetchOnDemand connectionId');
    const providerConfigKey = options.providerConfigKey;
    return {
      baseId: parsed.baseId,
      webhookId: parsed.webhookId,
      notificationId: parsed.webhookId,
      connectionId,
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
      path: notification,
      ...(providerConfigKey ? { providerConfigKey } : {}),
    };
  }

  if (notification.includes(':')) {
    const [baseId, webhookId] = notification.split(':', 2);
    if (baseId?.trim() && webhookId?.trim()) {
      const connectionId = requireString(options.connectionId, 'Airtable fetchOnDemand connectionId');
      const providerConfigKey = options.providerConfigKey;
      return {
        baseId: baseId.trim(),
        webhookId: webhookId.trim(),
        notificationId: webhookId.trim(),
        connectionId,
        ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        path: airtableNotificationPath(baseId.trim(), webhookId.trim()),
        ...(providerConfigKey ? { providerConfigKey } : {}),
      };
    }
  }

  if (options.defaultBaseId?.trim()) {
    const connectionId = requireString(options.connectionId, 'Airtable fetchOnDemand connectionId');
    const providerConfigKey = options.providerConfigKey;
    return {
      baseId: options.defaultBaseId.trim(),
      webhookId: notification.trim(),
      notificationId: notification.trim(),
      connectionId,
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
      path: airtableNotificationPath(options.defaultBaseId.trim(), notification.trim()),
      ...(providerConfigKey ? { providerConfigKey } : {}),
    };
  }

  throw new Error(
    'Airtable fetchOnDemand requires a notification object, a canonical notification path, or a "<baseId>:<webhookId>" identifier.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireString(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}
