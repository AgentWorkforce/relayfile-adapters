import type { BoxConfig } from './types.js';

export const BOX_SOURCE = "box";
export const BOX_PROVIDER_CONFIG_KEY = "box";
export const BOX_NANGO_FALLBACK_SYNC = "box-files";
export const BOX_SCOPES = [
  "root_readwrite"
] as const;

export const requiredConfigKeys = ['workspaceId', 'connectionId'] as const;

export function validateConfig(input: unknown): BoxConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Box config must be an object');
  }

  const record = input as Record<string, unknown>;
  const workspaceId = readRequiredString(record, 'workspaceId');
  const connectionId = readRequiredString(record, 'connectionId');
  const config: BoxConfig = {
    workspaceId,
    connectionId,
    providerConfigKey: readOptionalString(record, 'providerConfigKey') ?? "box",
  };

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key in config) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      config[key] = value as string | number | boolean;
    }
  }

  const nangoFallback = readOptionalString(record, 'nangoFallbackSyncName') ?? "box-files";
  if (nangoFallback) config.nangoFallbackSyncName = nangoFallback;
  return config;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Box config requires a non-empty ' + key);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
