import type { GoogleDriveConfig } from './types.js';

export const GOOGLEDRIVE_SOURCE = "google-drive";
export const GOOGLEDRIVE_PROVIDER_CONFIG_KEY = "google-drive";
export const GOOGLEDRIVE_NANGO_FALLBACK_SYNC = "google-drive-files";
export const GOOGLEDRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
] as const;

export const requiredConfigKeys = ['workspaceId', 'connectionId'] as const;

export function validateConfig(input: unknown): GoogleDriveConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Google Drive config must be an object');
  }

  const record = input as Record<string, unknown>;
  const workspaceId = readRequiredString(record, 'workspaceId');
  const connectionId = readRequiredString(record, 'connectionId');
  const config: GoogleDriveConfig = {
    workspaceId,
    connectionId,
    providerConfigKey: readOptionalString(record, 'providerConfigKey') ?? "google-drive",
  };

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key in config) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      config[key] = value as string | number | boolean;
    }
  }

  const nangoFallback = readOptionalString(record, 'nangoFallbackSyncName') ?? "google-drive-files";
  if (nangoFallback) config.nangoFallbackSyncName = nangoFallback;
  return config;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Google Drive config requires a non-empty ' + key);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
