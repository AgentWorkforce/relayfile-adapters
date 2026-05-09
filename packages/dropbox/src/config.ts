import type { DropboxConfig } from './types.js';

export const DROPBOX_SOURCE = "dropbox";
export const DROPBOX_PROVIDER_CONFIG_KEY = "dropbox";
export const DROPBOX_NANGO_FALLBACK_SYNC = "dropbox-files";
export const DROPBOX_SCOPES = [
  "files.metadata.read",
  "files.content.read",
  "files.content.write"
] as const;

export const requiredConfigKeys = ['workspaceId', 'connectionId'] as const;

export function validateConfig(input: unknown): DropboxConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Dropbox config must be an object');
  }

  const record = input as Record<string, unknown>;
  const workspaceId = readRequiredString(record, 'workspaceId');
  const connectionId = readRequiredString(record, 'connectionId');
  const config: DropboxConfig = {
    workspaceId,
    connectionId,
    providerConfigKey: readOptionalString(record, 'providerConfigKey') ?? "dropbox",
  };

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key in config) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      config[key] = value as string | number | boolean;
    }
  }

  const nangoFallback = readOptionalString(record, 'nangoFallbackSyncName') ?? "dropbox-files";
  if (nangoFallback) config.nangoFallbackSyncName = nangoFallback;
  return config;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Dropbox config requires a non-empty ' + key);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
