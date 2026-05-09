import type { OnedriveConfig } from './types.js';

export const ONEDRIVE_SOURCE = "onedrive";
export const ONEDRIVE_PROVIDER_CONFIG_KEY = "microsoft";
export const ONEDRIVE_NANGO_FALLBACK_SYNC = "onedrive-files";
export const ONEDRIVE_SCOPES = [
  "Files.ReadWrite.All",
  "offline_access"
] as const;

export const requiredConfigKeys = ['workspaceId', 'connectionId'] as const;

export function validateConfig(input: unknown): OnedriveConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('OneDrive config must be an object');
  }

  const record = input as Record<string, unknown>;
  const workspaceId = readRequiredString(record, 'workspaceId');
  const connectionId = readRequiredString(record, 'connectionId');
  const config: OnedriveConfig = {
    workspaceId,
    connectionId,
    providerConfigKey: readOptionalString(record, 'providerConfigKey') ?? "microsoft",
  };

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key in config) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      config[key] = value as string | number | boolean;
    }
  }

  const nangoFallback = readOptionalString(record, 'nangoFallbackSyncName') ?? "onedrive-files";
  if (nangoFallback) config.nangoFallbackSyncName = nangoFallback;
  return config;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('OneDrive config requires a non-empty ' + key);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
