import type { S3Config } from './types.js';

export const S3_SOURCE = "s3";
export const S3_PROVIDER_CONFIG_KEY = "aws-iam";
export const S3_NANGO_FALLBACK_SYNC = null;
export const S3_SCOPES = [
  "s3:GetObject",
  "s3:PutObject",
  "s3:DeleteObject",
  "sqs:ReceiveMessage"
] as const;

export const requiredConfigKeys = ['workspaceId', 'connectionId'] as const;

export function validateConfig(input: unknown): S3Config {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Amazon S3 config must be an object');
  }

  const record = input as Record<string, unknown>;
  const workspaceId = readRequiredString(record, 'workspaceId');
  const connectionId = readRequiredString(record, 'connectionId');
  const config: S3Config = {
    workspaceId,
    connectionId,
    providerConfigKey: readOptionalString(record, 'providerConfigKey') ?? "aws-iam",
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
    throw new Error('Amazon S3 config requires a non-empty ' + key);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
