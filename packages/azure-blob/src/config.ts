import type { AzureBlobConfig } from './types.js';

export const AZUREBLOB_SOURCE = "azure-blob";
export const AZUREBLOB_PROVIDER_CONFIG_KEY = "azure-storage";
export const AZUREBLOB_NANGO_FALLBACK_SYNC = null;
export const AZUREBLOB_SCOPES = [
  "https://storage.azure.com/user_impersonation"
] as const;

export const requiredConfigKeys = ['workspaceId', 'connectionId'] as const;

export function validateConfig(input: unknown): AzureBlobConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Azure Blob Storage config must be an object');
  }

  const record = input as Record<string, unknown>;
  const workspaceId = readRequiredString(record, 'workspaceId');
  const connectionId = readRequiredString(record, 'connectionId');
  const config: AzureBlobConfig = {
    workspaceId,
    connectionId,
    providerConfigKey: readOptionalString(record, 'providerConfigKey') ?? "azure-storage",
  };

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key in config) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      config[key] = value as string | number | boolean;
    }
  }

  const nangoFallback = readOptionalString(record, 'nangoFallbackSyncName') ?? undefined;
  if (nangoFallback) config.nangoFallbackSyncName = nangoFallback;
  return config;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Azure Blob Storage config requires a non-empty ' + key);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
