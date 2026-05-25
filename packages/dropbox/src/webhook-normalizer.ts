export interface NormalizedDropboxWebhook {
  provider: 'dropbox';
  eventType: 'file.changed';
  accountIds: string[];
  deliveryId: string | null;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toStringRecord(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

function readAccounts(payload: Record<string, unknown>): string[] {
  const listFolder = isObject(payload.list_folder) ? payload.list_folder : null;
  const accounts = listFolder?.accounts;
  if (!Array.isArray(accounts)) {
    return [];
  }
  return accounts
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeDropboxWebhook(
  payload: unknown,
  headers: Record<string, unknown> = {},
): NormalizedDropboxWebhook {
  const body = isObject(payload) ? payload : {};
  const normalizedHeaders = toStringRecord(headers);
  const deliveryId =
    normalizedHeaders['x-dropbox-request-id'] ??
    normalizedHeaders['x-request-id'] ??
    normalizedHeaders['x-delivery-id'] ??
    null;

  const accountIds = readAccounts(body);

  return {
    provider: 'dropbox',
    eventType: 'file.changed',
    accountIds,
    deliveryId,
    headers: normalizedHeaders,
    payload: body,
  };
}
